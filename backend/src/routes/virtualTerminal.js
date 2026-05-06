const express = require('express');
const QRCode = require('qrcode');
const { pool } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const eng = require('../services/transactionEngine');

const authNet = require('../services/processors/authorizeNet');
const paymentCloud = require('../services/processors/paymentCloud');
const nmi = require('../services/processors/nmi');
const shopify = require('../services/processors/shopify');

const router = express.Router();
router.use(authRequired);
// 'client_user' is allowed but per-handler gates enforce client_terminal_access permissions + limits.
router.use(requireRole('super_admin', 'owner', 'admin', 'finance_manager', 'operations_manager', 'client_user'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Authorize.net direct integration — Phase 4
// Endpoints: /test, /charge, /generate-link, /transactions,
//            /transactions/:id/status, /:id/void, /:id/refund
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/vt/test — verify Authorize.net auth
router.get('/test', requireRole('super_admin'), async (req, res) => {
  res.json(await authNet.testConnection());
});

// POST /api/vt/charge — direct PAN charge (SAQ-D unless wrapped in Accept.js)
router.post('/charge', async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    if (!b.amount || !b.card?.number || !b.card?.expiry || !b.card?.cvv) {
      return res.status(400).json({ error: 'Amount, card.number, card.expiry, card.cvv required' });
    }

    // Client-user limits
    if (req.user.role === 'client_user') {
      const acc = await c.query(
        'SELECT * FROM client_terminal_access WHERE client_id = $1',
        [req.user.client_id]
      );
      const ac = acc.rows[0];
      if (!ac || !ac.can_direct_charge) {
        return res.status(403).json({ error: 'Direct charge not enabled for your account' });
      }
      if (ac.per_transaction_limit && parseFloat(b.amount) > parseFloat(ac.per_transaction_limit)) {
        return res.status(400).json({ error: `Transaction limit is $${ac.per_transaction_limit}` });
      }
    }

    // Normalize expiry to MM/YY
    const expDigits = String(b.card.expiry).replace(/\D/g, '').slice(0, 4).padStart(4, '0');
    const expMmYy = `${expDigits.slice(0, 2)}/${expDigits.slice(2)}`;

    const result = await authNet.chargeCard({
      amount: b.amount,
      cardNumber: b.card.number,
      expirationDate: expMmYy,
      cardCode: b.card.cvv,
      firstName: b.customer?.firstName || '',
      lastName: b.customer?.lastName || '',
      email: b.customer?.email || '',
      phone: b.customer?.phone || '',
      description: b.description,
      invoiceNumber: b.invoiceNumber,
    });

    const last4 = result.last4 || String(b.card.number).slice(-4);
    const cardHolder = `${b.customer?.firstName || ''} ${b.customer?.lastName || ''}`.trim() || null;

    // Persist VT row regardless of success/decline (for audit + retry traceability)
    const vt = await c.query(`
      INSERT INTO vt_transactions
        (processor, processor_transaction_id, processor_auth_code,
         processor_response_code, processor_response_text,
         card_last4, card_type, card_holder_name,
         amount, charge_type, status, charged_by,
         client_id, entity_id, invoice_number, description,
         customer_email, logo_type, brand_name)
      VALUES ('authorize_net',$1,$2,$3,$4,$5,$6,$7,$8,'direct_charge',$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id
    `, [
      result.transactionId || null, result.authCode || null,
      result.responseCode || null,
      result.success ? 'Approved' : (result.message || 'Declined'),
      last4, result.accountType || null, cardHolder,
      parseFloat(b.amount).toFixed(2),
      result.success ? 'success' : 'declined',
      req.user.id, b.client_id || null, b.entity_id || null,
      b.invoiceNumber || null, b.description || null,
      b.customer?.email || null,
      b.logo_type || 'entity', b.brand_name || null,
    ]);
    const vtId = vt.rows[0].id;

    // Auto-save to master ledger if requested + successful
    if (b.save_to_ledger && result.success && b.client_id) {
      const cl = await c.query('SELECT * FROM clients WHERE id = $1', [b.client_id]);
      const client = cl.rows[0];
      const grossN = parseFloat(b.amount);
      // foundapay_fee_pct comes from frontend as decimal (0.30 not 30)
      const feePct = b.foundapay_fee_pct != null
        ? (parseFloat(b.foundapay_fee_pct) || 0)
        : (client ? eng.autoLookupCommissionPct(client, 'Debit/Credit Cards') : 0);

      let reservePct = 0;
      if (client) {
        const rule = eng.getReserveRule(client.name);
        if (rule) reservePct = rule.pct;
      }

      const calc = eng.calculateNet({
        gross_amount: grossN,
        foundapay_fee_pct: feePct,
        reserve_pct: reservePct,
        bearing_merchant_charges: 'Client',
      });

      const tx = await c.query(`
        INSERT INTO transactions
          (type, date_received, client_id, counterparty_type, counterparty_name,
           entity_id, payment_method, company_name, gross_amount,
           foundapay_fee_pct, fee_amount, net_amount,
           reserve_pct, reserve_amount,
           status, external_txn_id, processor_reference, notes, created_by)
        VALUES ('Received', CURRENT_DATE, $1, 'Client', $2, $3,
                'Debit/Credit Cards', $4, $5, $6, $7, $8, $9, $10,
                'Completed', $11, $12, $13, $14)
        RETURNING id
      `, [
        b.client_id, client?.name || 'Unknown', b.entity_id || null,
        process.env.AUTHNET_ENTITY || 'Designory Inc',
        calc.gross, feePct, calc.fee_amount, calc.net_amount,
        reservePct, calc.reserve_amount,
        result.transactionId, result.authCode,
        `VT charge via Authorize.net | ${b.description || ''} | Inv: ${b.invoiceNumber || ''}`.slice(0, 500),
        req.user.id,
      ]);

      if (calc.reserve_amount > 0) {
        await c.query(`
          INSERT INTO reserves (transaction_id, client_id, amount, bearer, reserve_type, hold_date, status)
          VALUES ($1,$2,$3,'Client',$4,CURRENT_DATE,'held')
        `, [tx.rows[0].id, b.client_id, calc.reserve_amount,
            eng.getReserveRule(client?.name)?.label || 'Auto-reserve']);
      }

      await c.query('UPDATE vt_transactions SET transaction_id = $1 WHERE id = $2',
        [tx.rows[0].id, vtId]);
    }

    // Audit
    await c.query(`
      INSERT INTO audit_logs (user_id, action, resource, resource_id, new_value, ip_address)
      VALUES ($1, $2, 'vt_transactions', $3, $4, $5)
    `, [
      req.user.id,
      result.success ? 'VT_CHARGE_SUCCESS' : 'VT_CHARGE_DECLINED',
      String(vtId),
      JSON.stringify({
        amount: b.amount, last4,
        transactionId: result.transactionId,
        authCode: result.authCode,
      }),
      req.ip || null,
    ]);

    res.json({ ...result, vtTransactionId: vtId });
  } catch (err) {
    console.error('[vt/charge]', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    c.release();
  }
});

// POST /api/vt/generate-link — hosted payment page (SAQ-A)
router.post('/generate-link', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.amount) return res.status(400).json({ error: 'Amount required' });

    // Client-user gating: must have client_terminal_access with can_generate_links=true,
    // and the amount must respect per_transaction_limit + daily_limit.
    if (req.user.role === 'client_user') {
      const acc = await pool.query(
        'SELECT * FROM client_terminal_access WHERE client_id = $1',
        [req.user.client_id]
      );
      const ac = acc.rows[0];
      if (!ac || !ac.can_generate_links) {
        return res.status(403).json({ error: 'Payment link generation not enabled for your account' });
      }
      const amt = parseFloat(b.amount);
      if (ac.per_transaction_limit && parseFloat(ac.per_transaction_limit) > 0 && amt > parseFloat(ac.per_transaction_limit)) {
        return res.status(400).json({ error: `Per-transaction limit is $${parseFloat(ac.per_transaction_limit).toFixed(2)}` });
      }
      if (ac.daily_limit && parseFloat(ac.daily_limit) > 0) {
        const todays = await pool.query(`
          SELECT COALESCE(SUM(amount), 0) AS total FROM vt_transactions
           WHERE client_id = $1 AND created_at >= CURRENT_DATE`,
          [req.user.client_id]
        );
        const todayTotal = parseFloat(todays.rows[0].total);
        if (todayTotal + amt > parseFloat(ac.daily_limit)) {
          return res.status(400).json({ error: `Daily limit $${parseFloat(ac.daily_limit).toFixed(2)} would be exceeded (today so far: $${todayTotal.toFixed(2)})` });
        }
      }
      // Force client_id + entity_id from the access record — don't let client override
      b.client_id = req.user.client_id;
      if (ac.entity_id) b.entity_id = ac.entity_id;
      if (ac.merchant_id) b.merchant_id = ac.merchant_id;
    }

    // Resolve logo from entity > client (entity takes priority since it's the
    // brand owner; client is a fallback for org-level branding).
    let logoUrl = null;
    if (b.entity_id) {
      const e = await pool.query('SELECT logo_url FROM entities WHERE id = $1', [b.entity_id]);
      logoUrl = e.rows[0]?.logo_url || null;
    }
    if (!logoUrl && b.client_id) {
      const c = await pool.query('SELECT logo_url FROM clients WHERE id = $1', [b.client_id]);
      logoUrl = c.rows[0]?.logo_url || null;
    }

    // Always emits our /pay/:token wrapper. Upstream Authorize.net token is
    // regenerated lazily on each customer click — see GET /pay/:token in
    // routes/payments.js. Default TTL is 24h, configurable per-link.
    const result = await authNet.generatePaymentLink({
      amount: b.amount,
      description: b.description,
      invoiceNumber: b.invoiceNumber,
      email: b.customer_email,
      brandName: b.brand_name || process.env.AUTHNET_ENTITY || 'FoundaPay',
      logoUrl, // resolved above; null = fall back to text brand on payment page
      expiryMinutes: parseInt(b.expiry_minutes || 1440, 10), // 24h default
      method: b.method || 'self_hosted', // 'self_hosted' renders our Accept.js page; 'auto' / 'hosted_redirect' use Authorize.net hosted page
      returnUrl: b.return_url || 'https://portal.foundapay.com',
      invoiceId: b.invoice_id || null, // when set, GET /pay/:token renders the detailed invoice page
    });

    if (!result.success) return res.status(502).json({ success: false, error: result.message });

    const qrCode = await QRCode.toDataURL(result.hostedUrl, {
      width: 220, margin: 2,
      color: { dark: '#7C3AED', light: '#FFFFFF' },
    });

    const vt = await pool.query(`
      INSERT INTO vt_transactions
        (processor, hosted_link_url, hosted_link_token, hosted_link_expires_at,
         amount, charge_type, status, charged_by,
         client_id, entity_id, invoice_number, description,
         customer_email, logo_type, brand_name)
      VALUES ('authorize_net',$1,$2,$3,$4,'hosted_link','pending',$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id
    `, [
      result.hostedUrl, result.token, result.expiresAt,
      parseFloat(b.amount).toFixed(2),
      req.user.id, b.client_id || null, b.entity_id || null,
      b.invoiceNumber || null, b.description || null,
      b.customer_email || null, b.logo_type || 'entity',
      b.brand_name || null,
    ]);

    // Mirror into payment_link_requests so the existing Payment Links page sees it
    if (b.client_id) {
      await pool.query(`
        INSERT INTO payment_link_requests
          (client_id, amount, payment_method, entity_id, processor_link, status, description, invoice_number, created_by, link_generated_at)
        VALUES ($1, $2, 'Debit/Credit Cards', $3, $4, 'link_generated', $5, $6, $7, NOW())
      `, [
        b.client_id, parseFloat(b.amount).toFixed(2), b.entity_id || null,
        result.hostedUrl, b.description || null, b.invoiceNumber || null, req.user.id,
      ]);
    }

    res.json({
      success: true,
      method: result.method, // 'authnet_hosted' or 'self_hosted'
      hostedUrl: result.hostedUrl,
      token: result.token,
      expiresAt: result.expiresAt,
      expiresInMinutes: result.expiresInMinutes,
      qrCode,
      vtTransactionId: vt.rows[0].id,
    });
  } catch (err) {
    console.error('[vt/generate-link]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vt/transactions
router.get('/transactions', async (req, res) => {
  try {
    let where = '';
    const params = [];
    if (req.user.role === 'client_user') {
      params.push(req.user.client_id);
      where = `WHERE vt.client_id = $${params.length}`;
    }
    const r = await pool.query(`
      SELECT vt.*, u.name AS charged_by_name, c.name AS client_name, e.legal_name AS entity_name
        FROM vt_transactions vt
        LEFT JOIN users u    ON u.id = vt.charged_by
        LEFT JOIN clients c  ON c.id = vt.client_id
        LEFT JOIN entities e ON e.id = vt.entity_id
        ${where}
       ORDER BY vt.created_at DESC LIMIT 200
    `, params);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vt/transactions/:id/status — refresh from Authorize.net
router.get('/transactions/:id/status', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM vt_transactions WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const vt = r.rows[0];
    if (req.user.role === 'client_user' && vt.client_id !== req.user.client_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (vt.processor_transaction_id) {
      const details = await authNet.getTransactionDetails(vt.processor_transaction_id);
      if (details) {
        const map = { '1': 'success', '2': 'declined', '3': 'error', '4': 'held' };
        const newStatus = map[details.responseCode] || vt.status;
        await pool.query('UPDATE vt_transactions SET status = $1 WHERE id = $2',
          [newStatus, vt.id]);
        return res.json({ status: newStatus, details });
      }
    }
    res.json({ status: vt.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vt/transactions/:id/void — same-day cancel
router.post('/transactions/:id/void', requireRole('super_admin'), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM vt_transactions WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const vt = r.rows[0];
    if (!vt.processor_transaction_id) return res.status(400).json({ error: 'No processor transaction to void' });
    const result = await authNet.voidTransaction(vt.processor_transaction_id);
    if (result.success) {
      await pool.query('UPDATE vt_transactions SET status = $1 WHERE id = $2',
        ['voided', vt.id]);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vt/transactions/:id/refund
router.post('/transactions/:id/refund', requireRole('super_admin'), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM vt_transactions WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const vt = r.rows[0];
    const result = await authNet.refundTransaction({
      transactionId: vt.processor_transaction_id,
      amount: req.body?.amount || vt.amount,
      cardLast4: vt.card_last4,
    });
    if (result.success) {
      await pool.query('UPDATE vt_transactions SET status = $1 WHERE id = $2',
        ['refunded', vt.id]);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ Public client key endpoint for Accept.js (frontend reads this) ━━━
router.get('/public-config', (req, res) => {
  res.json({
    publicClientKey: process.env.AUTHNET_PUBLIC_CLIENT_KEY || null,
    loginId:         process.env.AUTHNET_LOGIN_ID || null,
    sandbox:         process.env.AUTHNET_SANDBOX === 'true',
    entity:          process.env.AUTHNET_ENTITY || null,
  });
});

const PROCESSORS = {
  authorize_net: authNet,
  payment_cloud: paymentCloud,
  nmi: nmi,
  shopify: shopify,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/virtual-terminal/process-payment
// Body: {
//   processor: 'authorize_net' | 'payment_cloud' | 'nmi' | 'shopify',
//   amount, card: { number, expMonth, expYear, cvv },
//   customer: { firstName, lastName, email },
//   description, client_id, entity_id
// }
//
// ⚠ PCI WARNING: card.number is accepted in the request body. In production,
// switch the frontend to the processor's hosted-fields integration so this
// endpoint only ever receives a payment nonce/token.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/process-payment', async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    const errors = [];
    if (!b.processor || !PROCESSORS[b.processor]) errors.push('processor must be one of: authorize_net, payment_cloud, nmi, shopify');
    if (!b.amount || isNaN(parseFloat(b.amount))) errors.push('amount required');
    const isShopify = b.processor === 'shopify';
    if (!isShopify) {
      if (!b.card || !b.card.number) errors.push('card.number required');
      if (!b.card?.expMonth || !b.card?.expYear) errors.push('card.expMonth and card.expYear required');
      if (!b.card?.cvv) errors.push('card.cvv required');
    }
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const proc = PROCESSORS[b.processor];

    // Translate args to per-processor shape
    const expMonth = String(b.card?.expMonth || '').padStart(2, '0');
    const expYear = String(b.card?.expYear || '').slice(-2);
    const expDate = `${expMonth}${expYear}`;

    let result;
    if (b.processor === 'authorize_net') {
      result = await proc.chargeCard({
        amount: b.amount,
        cardNumber: b.card.number, expMonth, expYear, cvv: b.card.cvv,
        description: b.description, customer: b.customer || {},
      });
    } else if (b.processor === 'shopify') {
      result = await proc.chargeCard({
        amount: b.amount, description: b.description,
        customer: b.customer || {},
      });
    } else {
      // payment_cloud + nmi share the form-encoded shape
      result = await proc.chargeCard({
        amount: b.amount,
        cardNumber: b.card.number, expDate, cvv: b.card.cvv,
        firstName: b.customer?.firstName, lastName: b.customer?.lastName,
        description: b.description,
      });
    }

    if (!result.success) {
      return res.json({ success: false, error: result.message, processorResponse: result.raw });
    }

    // Look up client + commission
    let client = null;
    if (b.client_id) {
      const cr = await c.query('SELECT * FROM clients WHERE id = $1', [b.client_id]);
      client = cr.rows[0];
    }

    let feePct = 0;
    if (client && b.payment_method) {
      feePct = eng.autoLookupCommissionPct(client, b.payment_method) || 0;
    } else if (client) {
      feePct = parseFloat(client.card_pct) || 0; // direct charge defaults to card rate
    }

    // Auto reserve rule
    let reservePct = 0;
    if (client) {
      const rule = eng.getReserveRule(client.name);
      if (rule) reservePct = rule.pct;
    }

    const calc = eng.calculateNet({
      gross_amount: b.amount,
      foundapay_fee_pct: feePct,
      reserve_pct: reservePct,
      bearing_merchant_charges: 'Client',
    });

    // Persist as completed Received transaction (NEVER store card number)
    await c.query('BEGIN');
    const tx = await c.query(`
      INSERT INTO transactions
        (type, date_received, client_id, counterparty_type, counterparty_name,
         entity_id, payment_method, company_name, merchant_account,
         gross_amount, foundapay_fee_pct, fee_amount, merchant_charges,
         bearing_merchant_charges, net_amount, funds_available_date,
         reserve_pct, reserve_amount, status,
         external_txn_id, processor_reference, notes, created_by)
      VALUES ($1,$2,$3,'Client',$4,$5,$6,$7,$8,$9,$10,$11,0,'Client',$12,$13,$14,$15,'Completed',$16,$17,$18,$19)
      RETURNING *
    `, [
      'Received', new Date().toISOString().slice(0, 10),
      b.client_id || null, client?.name || `${b.customer?.firstName || ''} ${b.customer?.lastName || ''}`.trim() || null,
      b.entity_id || null, b.payment_method || 'Debit/Credit Cards',
      b.company_name || null, b.processor,
      calc.gross, feePct, calc.fee_amount,
      calc.net_amount, eng.defaultFundsAvailableDate(),
      reservePct, calc.reserve_amount,
      result.transactionId, result.authCode,
      `Direct charge via ${b.processor}. ${b.description || ''}`.slice(0, 500),
      req.user.id,
    ]);
    if (calc.reserve_amount > 0) {
      await c.query(`
        INSERT INTO reserves (transaction_id, client_id, amount, bearer, reserve_type, hold_date, status)
        VALUES ($1,$2,$3,'Client',$4,$5,'held')
      `, [tx.rows[0].id, b.client_id || null, calc.reserve_amount,
          eng.getReserveRule(client?.name)?.label || 'Auto-reserve',
          new Date().toISOString().slice(0, 10)]);
    }

    await c.query(
      `INSERT INTO audit_logs (user_id, action, resource, resource_id, new_value, ip_address)
       VALUES ($1, 'PROCESS_PAYMENT', 'transactions', $2, $3, $4)`,
      [req.user.id, String(tx.rows[0].id),
       JSON.stringify({ processor: b.processor, amount: b.amount, transactionId: result.transactionId, last4: result.last4 }),
       req.ip || null]
    );
    await c.query('COMMIT');

    res.json({
      success: true,
      transaction: tx.rows[0],
      processorResponse: {
        transactionId: result.transactionId,
        authCode: result.authCode,
        message: result.message,
        last4: result.last4,
        checkoutUrl: result.checkoutUrl,
      },
    });
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[vt/process-payment]', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    c.release();
  }
});

module.exports = router;
