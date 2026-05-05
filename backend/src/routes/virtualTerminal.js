const express = require('express');
const { pool } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const eng = require('../services/transactionEngine');

const authNet = require('../services/processors/authorizeNet');
const paymentCloud = require('../services/processors/paymentCloud');
const nmi = require('../services/processors/nmi');
const shopify = require('../services/processors/shopify');

const router = express.Router();
router.use(authRequired);
router.use(requireRole('super_admin', 'owner', 'admin', 'finance_manager', 'operations_manager'));

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
