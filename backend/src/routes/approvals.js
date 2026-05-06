// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Approval workflows.
//
// Lifecycle:
//   pending → admin_approved → super_approved → proof_uploaded → completed
//   any step can flip to → rejected
//
// Endpoints under /api/approvals (authRequired):
//   GET    /                  list (scoped by role)
//   GET    /:id               detail + reference rollup + audit notes
//   POST   /                  create new request
//   POST   /:id/admin-review  admin/super decides admin step
//   POST   /:id/super-review  super_admin decides super step
//   POST   /:id/upload-proof  multipart upload (PDF/PNG/JPG, 5MB)
//   POST   /:id/complete      super_admin executes the action
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const authNet = require('../services/processors/authorizeNet');

const router = express.Router();
router.use(authRequired);

const ADMIN_ROLES = ['super_admin', 'owner', 'admin'];
const SUPER_ROLES = ['super_admin', 'owner'];

const PROOF_DIR = '/var/www/foundapay/uploads/proofs';
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

// ━━━ GET / — list ━━━
router.get('/', async (req, res) => {
  try {
    const where = ['1=1'];
    const params = [];
    if (req.user.role === 'client_user') {
      params.push(req.user.id);
      where.push(`requested_by = $${params.length}`);
    } else if (!SUPER_ROLES.includes(req.user.role)) {
      // admin sees: pending OR admin_approved that need their action, plus their own
      params.push(req.user.id);
      where.push(`(requested_by = $${params.length} OR status IN ('pending','admin_approved','super_approved','proof_uploaded'))`);
    }
    if (req.query.status) {
      params.push(req.query.status); where.push(`status = $${params.length}`);
    }
    if (req.query.type) {
      params.push(req.query.type); where.push(`type = $${params.length}`);
    }
    const r = await pool.query(`
      SELECT a.*,
             u.name AS requested_by_name, u.email AS requested_by_email,
             ar.name AS admin_reviewed_by_name,
             sr.name AS super_reviewed_by_name
        FROM approval_requests a
        LEFT JOIN users u  ON u.id = a.requested_by
        LEFT JOIN users ar ON ar.id = a.admin_reviewed_by
        LEFT JOIN users sr ON sr.id = a.super_reviewed_by
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT 500
    `, params);

    // Stats — totals visible to this scope
    const sumP = pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int          AS pending_count,
        COUNT(*) FILTER (WHERE status = 'admin_approved')::int   AS awaiting_super_count,
        COUNT(*) FILTER (WHERE status = 'super_approved')::int   AS awaiting_proof_count,
        COUNT(*) FILTER (WHERE status = 'proof_uploaded')::int   AS ready_to_complete_count,
        COUNT(*) FILTER (WHERE status = 'completed')::int        AS completed_count,
        COUNT(*) FILTER (WHERE status = 'rejected')::int         AS rejected_count
        FROM approval_requests a WHERE ${where.join(' AND ')}
    `, params);
    const sumR = await sumP;
    res.json({ rows: r.rows, summary: sumR.rows[0] });
  } catch (err) {
    console.error('[approvals list]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /:id ━━━
router.get('/:id', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.*,
             u.name AS requested_by_name, u.email AS requested_by_email,
             ar.name AS admin_reviewed_by_name,
             sr.name AS super_reviewed_by_name,
             cb.name AS completed_by_name
        FROM approval_requests a
        LEFT JOIN users u  ON u.id = a.requested_by
        LEFT JOIN users ar ON ar.id = a.admin_reviewed_by
        LEFT JOIN users sr ON sr.id = a.super_reviewed_by
        LEFT JOIN users cb ON cb.id = a.completed_by
       WHERE a.id = $1
    `, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });

    // Reference rollup — pull related row for context
    let reference = null;
    const a = r.rows[0];
    if (a.reference_type === 'transaction' && a.reference_id) {
      const t = await pool.query(`
        SELECT id, gross_amount, fee_amount, net_amount, status, type,
               counterparty_name, payment_method, external_txn_id, processor_reference
          FROM transactions WHERE id = $1::int
      `, [a.reference_id]).catch(() => ({ rows: [] }));
      reference = t.rows[0] || null;
    } else if (a.reference_type === 'payout' && a.reference_id) {
      const p = await pool.query(
        `SELECT id, amount, currency, payout_method, status, sent_at, reference_number FROM payouts WHERE id = $1`,
        [a.reference_id]
      ).catch(() => ({ rows: [] }));
      reference = p.rows[0] || null;
    } else if (a.reference_type === 'expense' && a.reference_id) {
      const e = await pool.query('SELECT * FROM expenses WHERE id = $1', [a.reference_id]).catch(() => ({ rows: [] }));
      reference = e.rows[0] || null;
    }
    res.json({ approval: r.rows[0], reference });
  } catch (err) {
    console.error('[approvals detail]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST / — create new request ━━━
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.type) return res.status(400).json({ error: 'type required' });
    const r = await pool.query(`
      INSERT INTO approval_requests
        (type, status, reference_type, reference_id, amount, currency, requested_by, request_reason)
      VALUES ($1, 'pending', $2, $3, $4, COALESCE($5, 'USD'), $6, $7)
      RETURNING *
    `, [b.type, b.reference_type || null, b.reference_id || null,
        b.amount || null, b.currency, req.user.id, b.request_reason || null]);

    await logAudit({
      action: 'approval.created', entityType: 'approval_requests', entityId: r.rows[0].id,
      userId: req.user.id,
      metadata: { type: b.type, ref: `${b.reference_type}:${b.reference_id}`, amount: b.amount },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /:id/admin-review ━━━
router.post('/:id/admin-review', async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { decision, notes } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved|rejected' });

    const cur = await pool.query('SELECT status FROM approval_requests WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    if (cur.rows[0].status !== 'pending') return res.status(409).json({ error: `Cannot admin-review (status=${cur.rows[0].status})` });

    const newStatus = decision === 'approved' ? 'admin_approved' : 'rejected';
    const r = await pool.query(`
      UPDATE approval_requests
         SET admin_reviewed_by = $1, admin_reviewed_at = NOW(), admin_decision = $2, admin_notes = $3,
             status = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *
    `, [req.user.id, decision, notes || null, newStatus, req.params.id]);

    await logAudit({
      action: `approval.admin_${decision}`, entityType: 'approval_requests', entityId: req.params.id,
      userId: req.user.id, metadata: { notes: notes || null },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /:id/super-review ━━━
router.post('/:id/super-review', async (req, res) => {
  if (!SUPER_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Super admin only' });
  try {
    const { decision, notes } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved|rejected' });

    const cur = await pool.query('SELECT status FROM approval_requests WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    if (cur.rows[0].status !== 'admin_approved') {
      return res.status(409).json({ error: `Cannot super-review (status=${cur.rows[0].status})` });
    }

    const newStatus = decision === 'approved' ? 'super_approved' : 'rejected';
    const r = await pool.query(`
      UPDATE approval_requests
         SET super_reviewed_by = $1, super_reviewed_at = NOW(), super_decision = $2, super_notes = $3,
             status = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *
    `, [req.user.id, decision, notes || null, newStatus, req.params.id]);

    await logAudit({
      action: `approval.super_${decision}`, entityType: 'approval_requests', entityId: req.params.id,
      userId: req.user.id, metadata: { notes: notes || null },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /:id/upload-proof ━━━
router.post('/:id/upload-proof', proofUpload.single('proof'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const cur = await pool.query('SELECT status, requested_by FROM approval_requests WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const isOwner = cur.rows[0].requested_by === req.user.id;
    if (!isOwner && !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!['super_approved', 'proof_uploaded'].includes(cur.rows[0].status)) {
      return res.status(409).json({ error: `Cannot upload proof (status=${cur.rows[0].status})` });
    }
    const proofUrl = `/uploads/proofs/${path.basename(req.file.path)}`;
    const r = await pool.query(`
      UPDATE approval_requests
         SET proof_url = $1, proof_uploaded_at = NOW(), proof_uploaded_by = $2,
             status = 'proof_uploaded', updated_at = NOW()
       WHERE id = $3 RETURNING *
    `, [proofUrl, req.user.id, req.params.id]);

    await logAudit({
      action: 'approval.proof_uploaded', entityType: 'approval_requests', entityId: req.params.id,
      userId: req.user.id, metadata: { proof_url: proofUrl, mimetype: req.file.mimetype, size: req.file.size },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /:id/complete ━━━
// Executes the actual action. payout/refund/void talk to processor APIs.
router.post('/:id/complete', async (req, res) => {
  if (!SUPER_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Super admin only' });
  const c = await pool.connect();
  try {
    const cur = await c.query('SELECT * FROM approval_requests WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const a = cur.rows[0];
    if (!['proof_uploaded', 'super_approved'].includes(a.status)) {
      return res.status(409).json({ error: `Cannot complete (status=${a.status})` });
    }
    // Refunds/voids generally need proof; expense approvals don't.
    if (['refund_request', 'void_request', 'payout_request'].includes(a.type) && a.status !== 'proof_uploaded') {
      return res.status(409).json({ error: 'Proof must be uploaded first for this approval type' });
    }

    let actionResult = { ok: true };
    await c.query('BEGIN');

    if (a.type === 'payout_request' && a.reference_type === 'payout' && a.reference_id) {
      // Mark the existing payout as sent.
      await c.query(`UPDATE payouts SET status = 'sent', sent_at = NOW() WHERE id = $1`, [a.reference_id]);
    } else if (a.type === 'refund_request' && a.reference_type === 'transaction' && a.reference_id) {
      const tx = await c.query(`SELECT external_txn_id FROM transactions WHERE id = $1::int`, [a.reference_id]);
      if (tx.rows[0]?.external_txn_id) {
        const r = await authNet.refundTransaction({ transactionId: tx.rows[0].external_txn_id, amount: a.amount });
        actionResult = r;
        if (r.success) {
          await c.query(`UPDATE transactions SET status = 'Refunded', updated_at = NOW() WHERE id = $1::int`, [a.reference_id]);
        }
      }
    } else if (a.type === 'void_request' && a.reference_type === 'transaction' && a.reference_id) {
      const tx = await c.query(`SELECT external_txn_id FROM transactions WHERE id = $1::int`, [a.reference_id]);
      if (tx.rows[0]?.external_txn_id) {
        const r = await authNet.voidTransaction({ transactionId: tx.rows[0].external_txn_id });
        actionResult = r;
        if (r.success) {
          await c.query(`UPDATE transactions SET status = 'Voided', updated_at = NOW() WHERE id = $1::int`, [a.reference_id]);
        }
      }
    } else if (a.type === 'expense_approval' && a.reference_id) {
      await c.query(`UPDATE expenses SET status = 'approved' WHERE id = $1`, [a.reference_id]).catch(() => {});
    }

    const r = await c.query(`
      UPDATE approval_requests
         SET status = 'completed', completed_at = NOW(), completed_by = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *
    `, [req.user.id, req.params.id]);
    await c.query('COMMIT');

    await logAudit({
      action: 'approval.completed', entityType: 'approval_requests', entityId: req.params.id,
      userId: req.user.id, metadata: { type: a.type, action_result: actionResult },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json({ approval: r.rows[0], actionResult });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[approvals complete]', err);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

module.exports = router;
