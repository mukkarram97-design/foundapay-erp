// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Wise remittance API.
//
// Endpoints under /api/wise (authRequired):
//   GET    /balances                 — live balances from Wise
//   POST   /quote                    — create a quote
//   GET    /recipients               — list saved recipients
//   POST   /recipients               — create new recipient
//   GET    /                         — list ERP-side remittances
//   POST   /transfer                 — create transfer (NOT funded)
//   POST   /transfer/:id/fund        — fund transfer (super admin)
//   GET    /transfer/:id/status      — poll status from Wise + sync DB
//   POST   /sync                     — bulk sync all in-flight transfers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const wise = require('../services/wise');
const remittance = require('../services/remittance');

const router = express.Router();

// GET /api/wise/providers — list all available remittance providers + status
router.get('/providers', authRequired, (req, res) => {
  res.json({ providers: remittance.list() });
});

// POST /api/wise/manual — record a manual wire transfer (no Wise API call).
// Body: { recipientName, recipientBank, recipientAccount, recipientCountry,
//         sourceCurrency, targetCurrency, sourceAmount, targetAmount,
//         exchangeRate, providerFee, providerReference, reference, purpose,
//         payrollItemId? }
router.post('/manual', authRequired, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.sourceAmount || !b.recipientName) {
      return res.status(400).json({ error: 'sourceAmount and recipientName required' });
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(`
        INSERT INTO remittances
          (provider, provider_reference, provider_fee, provider_exchange_rate,
           source_currency, target_currency, source_amount, target_amount,
           exchange_rate, wise_fee,
           recipient_name, recipient_bank, recipient_account, recipient_country,
           purpose, reference,
           payroll_item_id, payout_id, expense_id,
           status, created_by)
        VALUES ('manual', $1, $2, $3,
                $4, $5, $6, $7,
                $8, NULL,
                $9, $10, $11, $12,
                $13, $14,
                $15, $16, $17,
                'transfer_created', $18)
        RETURNING *
      `, [
        b.providerReference || null, b.providerFee || null, b.exchangeRate || null,
        b.sourceCurrency || 'USD', b.targetCurrency || 'USD',
        b.sourceAmount, b.targetAmount || b.sourceAmount,
        b.exchangeRate || null,
        b.recipientName, b.recipientBank || null, b.recipientAccount || null, b.recipientCountry || null,
        b.purpose || 'other', b.reference || null,
        b.payrollItemId || null, b.payoutId || null, b.expenseId || null,
        req.user.id,
      ]);

      // Master Ledger integration — manual wires get a Processing tx row too.
      const tx = await c.query(`
        INSERT INTO transactions
          (type, status, source, payment_method,
           counterparty_type, counterparty_name,
           gross_amount, fee_amount, net_amount,
           external_txn_id, processor_reference,
           notes, created_by, date_received, updated_at)
        VALUES ('Paid', 'Processing', 'remittance', 'Wire Transfer',
                'Vendor', $1,
                $2::numeric, 0, $2::numeric,
                $3, $4,
                $5, $6, CURRENT_DATE, NOW())
        RETURNING id
      `, [
        b.recipientName || 'Manual wire',
        b.sourceAmount,
        b.providerReference || null,
        b.reference || null,
        `Manual wire to ${b.recipientName || 'recipient'} (${b.targetCurrency || 'USD'} ${b.targetAmount || ''}). Ref ${b.providerReference || '—'}.`.slice(0, 500),
        req.user.id,
      ]);
      await c.query(`UPDATE remittances SET transaction_id = $1 WHERE id = $2`, [tx.rows[0].id, r.rows[0].id]).catch(() => {});

      await c.query('COMMIT');

      await logAudit({
        action: 'remittance.manual_recorded', entityType: 'remittances', entityId: r.rows[0].id,
        userId: req.user.id,
        metadata: { amount: b.sourceAmount, currency: b.sourceCurrency, recipient: b.recipientName, reference: b.providerReference || b.reference, transaction_id: tx.rows[0].id },
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      });
      res.status(201).json({ remittance: r.rows[0] });
    } catch (err) {
      try { await c.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      c.release();
    }
    return;
  } catch (err) {
    console.error('[remittance manual]', err);
    res.status(500).json({ error: err.message });
  }
});
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

const SUPER_ROLES = ['super_admin', 'owner'];
function requireSuper(req, res, next) {
  if (!SUPER_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Super admin only' });
  next();
}

function requireConfigured(req, res, next) {
  if (!wise.isConfigured()) return res.status(503).json({ error: 'Wise not configured (WISE_API_TOKEN / WISE_PROFILE_ID missing)' });
  next();
}

// ━━━ GET /balances ━━━
router.get('/balances', requireConfigured, async (req, res) => {
  try {
    const r = await wise.getBalances();
    res.json({ balances: r });
  } catch (err) {
    console.error('[wise balances]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ━━━ POST /quote ━━━
router.post('/quote', requireConfigured, async (req, res) => {
  try {
    const r = await wise.createQuote(req.body || {});
    res.json(r);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ━━━ GET /recipients ━━━
router.get('/recipients', requireConfigured, async (req, res) => {
  try {
    const wiseRec = await wise.listRecipients(req.query.currency);
    res.json({ recipients: wiseRec });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ━━━ POST /recipients ━━━
router.post('/recipients', requireConfigured, async (req, res) => {
  try {
    const r = await wise.createRecipient(req.body || {});
    res.status(201).json(r);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ━━━ GET / — list ERP remittances ━━━
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT r.*, u.name AS created_by_name, ab.name AS approved_by_name
        FROM remittances r
        LEFT JOIN users u  ON u.id = r.created_by
        LEFT JOIN users ab ON ab.id = r.approved_by
       ORDER BY r.created_at DESC LIMIT 500
    `);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /transfer — create transfer (uses an existing quote) ━━━
// Body: { quoteUuid, recipientId, recipientName, recipientBank, recipientAccount,
//         sourceCurrency, targetCurrency, sourceAmount, targetAmount, exchangeRate, wiseFee,
//         purpose, reference, payrollItemId }
router.post('/transfer', requireConfigured, async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    const customerTransactionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : require('crypto').randomBytes(16).toString('hex');

    const wiseRes = await wise.createTransfer({
      targetAccount: parseInt(b.recipientId, 10),
      quoteUuid: b.quoteUuid,
      customerTransactionId,
      reference: b.reference || 'FoundaPay',
    });

    await c.query('BEGIN');
    const r = await c.query(`
      INSERT INTO remittances
        (wise_transfer_id, wise_quote_id, recipient_id,
         source_currency, target_currency, source_amount, target_amount,
         exchange_rate, wise_fee,
         recipient_name, recipient_bank, recipient_account, recipient_country,
         purpose, reference,
         payroll_item_id, payout_id, expense_id,
         status, wise_status, estimated_delivery,
         created_by, provider)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
              'transfer_created', $19, $20, $21, 'wise')
      RETURNING *
    `, [
      String(wiseRes.id), b.quoteUuid, String(b.recipientId),
      b.sourceCurrency || 'USD', b.targetCurrency || 'PKR',
      b.sourceAmount, b.targetAmount, b.exchangeRate, b.wiseFee,
      b.recipientName || null, b.recipientBank || null, b.recipientAccount || null, b.recipientCountry || null,
      b.purpose || 'other', b.reference || null,
      b.payrollItemId || null, b.payoutId || null, b.expenseId || null,
      wiseRes.status || null, wiseRes.estimatedDelivery || null,
      req.user.id,
    ]);

    // Master Ledger integration: every remittance is also a Paid transaction.
    const tx = await c.query(`
      INSERT INTO transactions
        (type, status, source, payment_method,
         counterparty_type, counterparty_name,
         gross_amount, fee_amount, net_amount,
         external_txn_id, processor_reference,
         notes, created_by, date_received, updated_at)
      VALUES ('Paid', 'Processing', 'remittance', 'Wire Transfer',
              'Vendor', $1,
              $2::numeric, 0, $2::numeric,
              $3, $4,
              $5, $6, CURRENT_DATE, NOW())
      RETURNING id
    `, [
      b.recipientName || 'Wise transfer',
      b.sourceAmount,
      String(wiseRes.id),
      b.reference || null,
      `Wise transfer to ${b.recipientName || 'recipient'} (${b.targetCurrency || 'PKR'} ${b.targetAmount || ''}). Quote ${b.quoteUuid}.`.slice(0, 500),
      req.user.id,
    ]);
    // Tie the remittance back to the master-ledger row so detail pages can link.
    await c.query(`UPDATE remittances SET transaction_id = $1 WHERE id = $2`, [tx.rows[0].id, r.rows[0].id]).catch(() => {});

    await c.query('COMMIT');

    await logAudit({
      action: 'wise.transfer_created', entityType: 'remittances', entityId: r.rows[0].id,
      userId: req.user.id,
      metadata: { wise_transfer_id: wiseRes.id, amount: b.sourceAmount, currency: b.sourceCurrency, recipient: b.recipientName },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ remittance: r.rows[0], wise: wiseRes });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[wise transfer]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ POST /transfer/:id/fund — actually send the money ━━━
router.post('/transfer/:id/fund', requireSuper, requireConfigured, async (req, res) => {
  try {
    const cur = await pool.query('SELECT * FROM remittances WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = cur.rows[0];
    if (!r.wise_transfer_id) return res.status(400).json({ error: 'No Wise transfer ID' });

    const result = await wise.fundTransfer(r.wise_transfer_id);
    await pool.query(`
      UPDATE remittances
         SET status = 'processing', wise_status = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $3
    `, [result?.status || result?.errorCode || 'FUNDED', req.user.id, req.params.id]);

    await logAudit({
      action: 'wise.transfer_funded', entityType: 'remittances', entityId: req.params.id,
      userId: req.user.id, metadata: { wise_transfer_id: r.wise_transfer_id, result },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    // If linked to a payroll item, mark it paid.
    if (r.payroll_item_id) {
      await pool.query(`UPDATE salary_items SET status = 'paid', paid_at = NOW() WHERE id = $1`, [r.payroll_item_id]).catch(() => {});
    }

    res.json({ ok: true, result });
  } catch (err) {
    console.error('[wise fund]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ━━━ GET /transfer/:id/status ━━━
router.get('/transfer/:id/status', requireConfigured, async (req, res) => {
  try {
    const cur = await pool.query('SELECT wise_transfer_id FROM remittances WHERE id = $1', [req.params.id]);
    if (!cur.rows.length || !cur.rows[0].wise_transfer_id) return res.status(404).json({ error: 'Not found' });
    const w = await wise.getTransfer(cur.rows[0].wise_transfer_id);
    const completed = ['outgoing_payment_sent', 'funds_converted', 'paid'].includes(String(w.status).toLowerCase());
    await pool.query(`
      UPDATE remittances
         SET wise_status = $1, status = $2,
             completed_at = CASE WHEN $3::boolean THEN NOW() ELSE completed_at END,
             updated_at = NOW()
       WHERE id = $4
    `, [w.status, completed ? 'completed' : 'processing', completed, req.params.id]);
    res.json(w);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ━━━ POST /sync — bulk poll all in-flight remittances ━━━
router.post('/sync', requireConfigured, async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, wise_transfer_id FROM remittances WHERE status IN ('transfer_created','processing') AND wise_transfer_id IS NOT NULL`);
    let updated = 0;
    for (const row of r.rows) {
      try {
        const w = await wise.getTransfer(row.wise_transfer_id);
        const completed = ['outgoing_payment_sent', 'funds_converted', 'paid'].includes(String(w.status).toLowerCase());
        await pool.query(`
          UPDATE remittances
             SET wise_status = $1, status = $2,
                 completed_at = CASE WHEN $3::boolean THEN NOW() ELSE completed_at END,
                 updated_at = NOW()
           WHERE id = $4
        `, [w.status, completed ? 'completed' : 'processing', completed, row.id]);
        updated++;
      } catch { /* skip individual failures */ }
    }
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
