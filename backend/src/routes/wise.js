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
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const wise = require('../services/wise');
const remittance = require('../services/remittance');

const router = express.Router();

// Proof uploads — wire confirmations, bank receipts, etc.
const PROOF_DIR = '/var/www/foundapay/uploads/remittance-proofs';
try { fs.mkdirSync(PROOF_DIR, { recursive: true }); } catch {}
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: PROOF_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname).toLowerCase() || '.pdf').slice(0, 6);
      cb(null, `proof-${req.params.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('PDF, PNG, or JPG only'));
    cb(null, true);
  },
});

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

// Map a Wise transfer status string to our internal high-level state.
// Wise emits: incoming_payment_waiting, incoming_payment_initiated,
//   processing, funds_converted, outgoing_payment_sent, bounced_back,
//   cancelled, funds_refunded, charged_back.
function mapWiseStatus(s) {
  const v = String(s || '').toLowerCase();
  if (['outgoing_payment_sent', 'funds_converted', 'paid'].includes(v)) return 'completed';
  if (['cancelled'].includes(v)) return 'cancelled';
  if (['bounced_back', 'funds_refunded', 'charged_back'].includes(v)) return 'failed';
  if (['incoming_payment_waiting', 'pending'].includes(v)) return 'transfer_created';
  return 'processing';
}

// Append a timeline event to remittances.timeline if not already present.
// Idempotent on (event + at) so polling doesn't dupe rows.
async function appendTimelineEvent(client, remittanceId, evt) {
  await client.query(`
    UPDATE remittances
       SET timeline = COALESCE(timeline, '[]'::jsonb) || $1::jsonb
     WHERE id = $2
       AND NOT (
         COALESCE(timeline, '[]'::jsonb) @> jsonb_build_array(
           jsonb_build_object('event', $1::jsonb->0->>'event', 'at', $1::jsonb->0->>'at')
         )
       )
  `, [JSON.stringify([evt]), remittanceId]);
}

// ━━━ POST /transfer/:id/fund — actually send the money ━━━
router.post('/transfer/:id/fund', requireSuper, requireConfigured, async (req, res) => {
  const c = await pool.connect();
  try {
    const cur = await c.query('SELECT * FROM remittances WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = cur.rows[0];
    if (!r.wise_transfer_id) return res.status(400).json({ error: 'No Wise transfer ID' });

    const result = await wise.fundTransfer(r.wise_transfer_id);

    await c.query('BEGIN');
    await c.query(`
      UPDATE remittances
         SET status = 'processing', wise_status = $1,
             approved_by = $2, approved_at = NOW(),
             funded_at = COALESCE(funded_at, NOW()),
             updated_at = NOW()
       WHERE id = $3
    `, [result?.status || result?.errorCode || 'FUNDED', req.user.id, req.params.id]);

    await appendTimelineEvent(c, req.params.id, {
      event: 'funded',
      at: new Date().toISOString(),
      description: `Funded by ${req.user.name || req.user.email}`,
      actor: req.user.id,
    });
    await c.query('COMMIT');

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
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[wise fund]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ GET /transfer/:id/status — fetch live Wise status, persist, return enriched ━━━
router.get('/transfer/:id/status', requireConfigured, async (req, res) => {
  const c = await pool.connect();
  try {
    const cur = await c.query('SELECT * FROM remittances WHERE id = $1', [req.params.id]);
    if (!cur.rows.length || !cur.rows[0].wise_transfer_id) return res.status(404).json({ error: 'Not found' });
    const row = cur.rows[0];

    const w = await wise.getTransfer(row.wise_transfer_id);
    const internalStatus = mapWiseStatus(w.status);
    const completed = internalStatus === 'completed';
    const failed    = internalStatus === 'failed';

    await c.query('BEGIN');
    await c.query(`
      UPDATE remittances
         SET wise_status = $1, status = $2,
             completed_at = CASE WHEN $3::boolean AND completed_at IS NULL THEN NOW() ELSE completed_at END,
             failed_at    = CASE WHEN $4::boolean AND failed_at    IS NULL THEN NOW() ELSE failed_at END,
             failure_reason = CASE WHEN $4::boolean THEN COALESCE(failure_reason, $5) ELSE failure_reason END,
             last_status_check = NOW(),
             updated_at = NOW()
       WHERE id = $6
    `, [w.status, internalStatus, completed, failed, w.errorCode || null, req.params.id]);

    // Push the current Wise status as a timeline entry (idempotent).
    await appendTimelineEvent(c, req.params.id, {
      event: w.status,
      at: new Date().toISOString(),
      description: `Wise: ${w.status}`,
    });

    // On completion, flip the linked transactions row to Completed and the
    // payroll_item (if linked) to paid — same effect as /:id/fund did for the
    // funding step, but for the actual outgoing-payment-sent step.
    if (completed) {
      if (row.transaction_id) {
        await c.query(`UPDATE transactions SET status='Completed', updated_at=NOW() WHERE id=$1 AND status<>'Completed'`, [row.transaction_id]).catch(() => {});
      }
      if (row.payroll_item_id) {
        await c.query(`UPDATE salary_items SET status='paid', paid_at=COALESCE(paid_at, NOW()) WHERE id=$1`, [row.payroll_item_id]).catch(() => {});
      }
    }
    await c.query('COMMIT');

    // Reload to return the persisted shape (timeline included).
    const after = await c.query('SELECT * FROM remittances WHERE id = $1', [req.params.id]);
    res.json({ wise: w, remittance: after.rows[0] });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[wise status]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ GET /transfer/:id/tracking — extract recipient-facing tracking URL ━━━
router.get('/transfer/:id/tracking', requireConfigured, async (req, res) => {
  try {
    const cur = await pool.query('SELECT wise_transfer_id, wise_tracking_url FROM remittances WHERE id = $1', [req.params.id]);
    if (!cur.rows.length || !cur.rows[0].wise_transfer_id) return res.status(404).json({ error: 'Not found' });

    // Cached?
    if (cur.rows[0].wise_tracking_url) {
      return res.json({ trackingUrl: cur.rows[0].wise_tracking_url, cached: true });
    }

    const payments = await wise.getPayments(cur.rows[0].wise_transfer_id);
    // Wise's response shape varies — the tracking url tends to live on a
    // payment-out item or a top-level field. Best-effort extraction.
    const trackingUrl =
      payments?.trackingUrl ||
      payments?.statusUrl ||
      payments?.payments?.find?.((p) => p.trackingUrl)?.trackingUrl ||
      null;
    if (trackingUrl) {
      await pool.query('UPDATE remittances SET wise_tracking_url = $1, updated_at = NOW() WHERE id = $2', [trackingUrl, req.params.id]);
    }
    res.json({ trackingUrl, payments });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ━━━ GET /transfer/:id/receipt — proxy Wise's receipt PDF ━━━
router.get('/transfer/:id/receipt', requireConfigured, async (req, res) => {
  try {
    const cur = await pool.query('SELECT wise_transfer_id, recipient_name FROM remittances WHERE id = $1', [req.params.id]);
    if (!cur.rows.length || !cur.rows[0].wise_transfer_id) return res.status(404).json({ error: 'Not found' });
    const wid = cur.rows[0].wise_transfer_id;
    const name = (cur.rows[0].recipient_name || 'recipient').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
    const pdf = await wise.getReceiptPdf(wid);
    res.setHeader('Content-Type', pdf.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="FoundaPay-Remittance-${wid}-${name}.pdf"`);
    res.send(pdf.buffer);
  } catch (err) {
    console.error('[wise receipt]', err.message);
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

// ━━━ POST /api/wise/manual/:id/proof — upload bank confirmation, mark completed ━━━
// Closes the loop on a manual-wire remittance:
//   1. Stores the proof file under /uploads/remittance-proofs/
//   2. Updates remittances: status='completed', proof_url, proof_uploaded_*, completed_at
//   3. Updates linked transactions row to status='Completed'
//   4. If linked to a salary_items row, marks it paid (same as Wise fund flow)
router.post('/manual/:id/proof', authRequired, proofUpload.single('proof'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const c = await pool.connect();
  try {
    const cur = await c.query('SELECT * FROM remittances WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const row = cur.rows[0];
    if ((row.provider || row.channel || 'wise') !== 'manual') {
      return res.status(400).json({ error: 'Proof upload is only for manual wires (Wise transfers go through /:id/fund)' });
    }
    const proofUrl = `/uploads/remittance-proofs/${path.basename(req.file.path)}`;

    await c.query('BEGIN');
    await c.query(`
      UPDATE remittances
         SET proof_url = $1, proof_uploaded_at = NOW(), proof_uploaded_by = $2,
             status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $3
    `, [proofUrl, req.user.id, req.params.id]);

    if (row.transaction_id) {
      await c.query(
        `UPDATE transactions SET status = 'Completed', updated_at = NOW() WHERE id = $1`,
        [row.transaction_id]
      ).catch(() => {});
    }
    if (row.payroll_item_id) {
      await c.query(
        `UPDATE salary_items SET status = 'paid', paid_at = NOW() WHERE id = $1`,
        [row.payroll_item_id]
      ).catch(() => {});
    }
    await c.query('COMMIT');

    await logAudit({
      action: 'remittance.proof_uploaded',
      entityType: 'remittances', entityId: req.params.id,
      userId: req.user.id,
      metadata: { proof_url: proofUrl, mimetype: req.file.mimetype, size: req.file.size },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json({ ok: true, proof_url: proofUrl });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[remittance proof]', err);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ Saved recipients (ERP-side address book) ━━━
//
// GET    /api/wise/saved-recipients              list all active
// POST   /api/wise/saved-recipients              create one
// DELETE /api/wise/saved-recipients/:id          soft-delete
//
// Lives separately from Wise's own recipient list so manual-wire recipients
// (which never get pushed to Wise) can also be saved + reused.

router.get('/saved-recipients', authRequired, async (req, res) => {
  try {
    const where = ['is_deleted = false'];
    const params = [];
    if (req.query.country) { params.push(req.query.country); where.push(`country = $${params.length}`); }
    const r = await pool.query(`
      SELECT * FROM remittance_recipients
       WHERE ${where.join(' AND ')}
       ORDER BY name ASC LIMIT 500
    `, params);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/saved-recipients', authRequired, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`
      INSERT INTO remittance_recipients
        (name, country, bank_name, account_type, iban, account_number,
         routing_number, sort_code, swift_bic, branch_code,
         city, address_line, post_code, email, legal_type,
         wise_recipient_id, notes, payroll_item_link, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,'PRIVATE'),
              $16,$17,$18,$19)
      RETURNING *
    `, [
      b.name, b.country || null, b.bank_name || null, b.account_type || null,
      b.iban || null, b.account_number || null,
      b.routing_number || null, b.sort_code || null, b.swift_bic || null, b.branch_code || null,
      b.city || null, b.address_line || null, b.post_code || null, b.email || null, b.legal_type,
      b.wise_recipient_id || null, b.notes || null, b.payroll_item_link || null, req.user.id,
    ]);

    await logAudit({
      action: 'remittance.recipient_saved',
      entityType: 'remittance_recipients', entityId: r.rows[0].id,
      userId: req.user.id,
      metadata: { name: b.name, country: b.country, has_wise_id: !!b.wise_recipient_id },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[saved recipients post]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/saved-recipients/:id', authRequired, async (req, res) => {
  try {
    await pool.query(
      'UPDATE remittance_recipients SET is_deleted = true, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
