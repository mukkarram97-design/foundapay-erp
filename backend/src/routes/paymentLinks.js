// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Payment Links — admin/operator API
//
// Existing endpoints (unchanged shape so the legacy frontend keeps working):
//   GET    /                — list  (returns { rows: [...] } when no filters)
//   POST   /                — create
//   PATCH  /:id             — partial update
//
// New endpoints (require Batch 2 schema migration to be fully functional):
//   GET    /          ?tab&q&client_id&created_by&from&to&min_amount&max_amount&page&limit&sort
//                          — enhanced list with summary  (returns { results, total, page, limit, summary })
//   GET    /:id             — detail with timeline
//   POST   /:id/cancel      — set status='cancelled' + audit log
//   POST   /:id/resend-email — resend payment-link email (uses existing email.js)
//   GET    /:id/qr.png      — PNG QR code of public URL
//   GET    /export.csv      — CSV stream, same filters as enhanced list
//
// URL convention (post-Batch 2): URL is computed from token on every read as
//   ${process.env.PORTAL_URL}/pay/${token}
// We never trust a stored URL field. processor_link is being phased out.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const QRCode = require('qrcode');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const email = require('../services/email');

const router = express.Router();

router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') {
    // client_user is allowed on the new module endpoints — gated per-row in queries
    // but we keep them out of POST/PATCH (creator-only operations).
    if (req.method === 'POST' || req.method === 'PATCH') {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  next();
});

// ━━━ Helpers ─────────────────────────────────────────────────

const STAFF_FEE_VIEW = ['super_admin', 'owner', 'admin', 'finance_manager'];
const STAFF_EDIT     = ['super_admin', 'owner', 'admin', 'finance_manager'];
const READ_ONLY_ROLES = ['operations_manager', 'accountant', 'remote_operator', 'entity_owner', 'auditor'];

function canSeeFee(user)    { return STAFF_FEE_VIEW.includes(user.role); }
function canEdit(user)      { return STAFF_EDIT.includes(user.role); }
function canSeeCreator(user){ return user.role !== 'client_user'; }

function publicUrlFromToken(token) {
  if (!token) return null;
  const base = process.env.PORTAL_URL || 'https://portal.foundapay.com';
  return `${base.replace(/\/+$/, '')}/pay/${token}`;
}

// Map list-tab → SQL fragment.  Pre-Batch-2 the expires_at clause will fail.
function tabToSql(tab) {
  switch ((tab || 'all').toLowerCase()) {
    case 'pending':
      return `(
        plr.status NOT IN ('paid','cancelled','failed','refunded','expired')
        AND (plr.expires_at IS NULL OR plr.expires_at > NOW())
      )`;
    case 'paid':
      return `plr.status = 'paid'`;
    case 'expired':
      return `(
        plr.status = 'expired'
        OR (plr.status NOT IN ('paid','cancelled','failed','refunded')
            AND plr.expires_at IS NOT NULL AND plr.expires_at < NOW())
      )`;
    case 'cancelled':
      return `plr.status IN ('cancelled','failed','refunded')`;
    case 'all':
    default:
      return `TRUE`;
  }
}

function rowToResult(row, user) {
  const out = {
    id: row.id,
    token: row.token || null,
    url: publicUrlFromToken(row.token),
    status: row.status,
    amount: row.amount == null ? null : Number(row.amount),
    currency: row.currency || 'USD',
    description: row.description,
    customer_email: row.customer_email,
    customer_name: row.customer_name,
    invoice_number: row.invoice_number,
    payment_method: row.payment_method,
    client: row.client_id ? { id: row.client_id, name: row.client_name || null } : null,
    merchant: row.merchant_id ? { id: row.merchant_id, name: row.processor_name || null } : null,
    entity: row.entity_id ? { id: row.entity_id, name: row.entity_name || null } : null,
    created_at: row.created_at,
    expires_at: row.expires_at || null,
    paid_at: row.paid_at || null,
    attempts: row.attempts == null ? 0 : Number(row.attempts),
    last_error: row.last_error || null,
    transaction: row.transaction_id ? { id: row.transaction_id } : null,
  };
  if (canSeeCreator(user) && row.created_by) {
    out.created_by = {
      id: row.created_by,
      name: row.created_by_name || null,
      role: row.created_by_role || null,
    };
  }
  if (canSeeFee(user)) {
    const feeDecimal = parseFloat(row.card_pct) || 0;
    out.fp_fee = row.amount == null ? null : Number((row.amount * feeDecimal).toFixed(2));
  }
  return out;
}

function isFiltered(q) {
  return !!(
    q.tab || q.q || q.client_id || q.created_by ||
    q.from || q.to || q.min_amount || q.max_amount ||
    q.page || q.limit || q.sort
  );
}

// ━━━ GET / — list (legacy + enhanced) ────────────────────────
router.get('/', async (req, res) => {
  // Legacy mode: no filter params → keep old shape so legacy frontend keeps working.
  if (!isFiltered(req.query)) {
    try {
      const params = [];
      let where = 'TRUE';
      if (req.user.role === 'client_user' && req.user.client_id) {
        params.push(req.user.client_id);
        where = `plr.client_id = $${params.length}`;
      }
      const r = await pool.query(`
        SELECT plr.*, c.name AS client_name, e.legal_name AS entity_name, m.processor_name
          FROM payment_link_requests plr
          LEFT JOIN clients c ON c.id = plr.client_id
          LEFT JOIN entities e ON e.id = plr.entity_id
          LEFT JOIN merchants m ON m.id = plr.merchant_id
         WHERE ${where}
         ORDER BY plr.created_at DESC
      `, params);
      return res.json({ rows: r.rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Enhanced mode (any filter param present)
  try {
    const q = req.query;
    const params = [];
    const where = [];

    where.push(tabToSql(q.tab));

    if (q.q) {
      params.push(`%${q.q}%`);
      const idx = params.length;
      where.push(`(
        plr.token::text ILIKE $${idx}
        OR plr.description ILIKE $${idx}
        OR plr.customer_email ILIKE $${idx}
        OR plr.customer_name ILIKE $${idx}
      )`);
    }

    if (req.user.role === 'client_user' && req.user.client_id) {
      params.push(req.user.client_id);
      where.push(`plr.client_id = $${params.length}`);
    } else if (q.client_id) {
      const ids = String(q.client_id).split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) {
        params.push(ids);
        where.push(`plr.client_id = ANY($${params.length}::uuid[])`);
      }
    }

    if (q.created_by && req.user.role !== 'client_user') {
      const ids = String(q.created_by).split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) {
        params.push(ids);
        where.push(`plr.created_by = ANY($${params.length}::uuid[])`);
      }
    }

    if (q.from) { params.push(q.from); where.push(`plr.created_at >= $${params.length}`); }
    if (q.to)   { params.push(q.to);   where.push(`plr.created_at <= $${params.length}`); }
    if (q.min_amount) { params.push(q.min_amount); where.push(`plr.amount >= $${params.length}`); }
    if (q.max_amount) { params.push(q.max_amount); where.push(`plr.amount <= $${params.length}`); }

    const sortCol = ({
      created_at: 'plr.created_at',
      amount: 'plr.amount',
      expires_at: 'plr.expires_at',
    })[q.sort] || 'plr.created_at';
    const sortDir = q.sort_dir === 'asc' ? 'ASC' : 'DESC';

    const limit = Math.max(1, Math.min(100, parseInt(q.limit, 10) || 20));
    const page  = Math.max(1, parseInt(q.page, 10) || 1);
    const offset = (page - 1) * limit;

    const whereSql = where.join(' AND ');

    const totalQ = pool.query(
      `SELECT COUNT(*)::int AS total FROM payment_link_requests plr WHERE ${whereSql}`,
      params
    );

    const summaryQ = pool.query(
      `SELECT
         COUNT(*)::int                                          AS total_count,
         COUNT(*) FILTER (WHERE plr.status NOT IN ('paid','cancelled','failed','refunded','expired')
                            AND (plr.expires_at IS NULL OR plr.expires_at > NOW()))::int AS pending_count,
         COUNT(*) FILTER (WHERE plr.status = 'paid')::int       AS paid_count,
         COUNT(*) FILTER (WHERE plr.status = 'paid'
                            AND plr.paid_at >= date_trunc('month', NOW()))::int AS paid_this_month,
         COALESCE(SUM(plr.amount) FILTER (WHERE plr.status = 'paid'), 0)::float AS total_volume_paid,
         COALESCE(SUM(plr.amount * COALESCE(c.card_pct, 0))
                    FILTER (WHERE plr.status = 'paid'), 0)::float AS total_fp_fee_earned
         FROM payment_link_requests plr
         LEFT JOIN clients c ON c.id = plr.client_id
         WHERE ${whereSql}`,
      params
    );

    const pageParams = params.slice();
    pageParams.push(limit); pageParams.push(offset);
    const dataQ = pool.query(
      `SELECT plr.*, c.name AS client_name, c.card_pct,
              e.legal_name AS entity_name,
              m.processor_name,
              u.name AS created_by_name, u.role AS created_by_role
         FROM payment_link_requests plr
         LEFT JOIN clients   c ON c.id = plr.client_id
         LEFT JOIN entities  e ON e.id = plr.entity_id
         LEFT JOIN merchants m ON m.id = plr.merchant_id
         LEFT JOIN users     u ON u.id = plr.created_by
        WHERE ${whereSql}
        ORDER BY ${sortCol} ${sortDir}
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );

    const [totalR, summaryR, dataR] = await Promise.all([totalQ, summaryQ, dataQ]);
    const summary = summaryR.rows[0] || {};
    if (!canSeeFee(req.user)) delete summary.total_fp_fee_earned;

    res.json({
      results: dataR.rows.map((r) => rowToResult(r, req.user)),
      total: totalR.rows[0].total,
      page, limit,
      summary,
    });
  } catch (err) {
    console.error('[paymentLinks GET enhanced]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /export.csv ─────────────────────────────────────────
router.get('/export.csv', async (req, res) => {
  try {
    const q = req.query;
    const params = [];
    const where = [tabToSql(q.tab)];

    if (req.user.role === 'client_user' && req.user.client_id) {
      params.push(req.user.client_id);
      where.push(`plr.client_id = $${params.length}`);
    } else if (q.client_id) {
      const ids = String(q.client_id).split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) {
        params.push(ids);
        where.push(`plr.client_id = ANY($${params.length}::uuid[])`);
      }
    }
    if (q.from) { params.push(q.from); where.push(`plr.created_at >= $${params.length}`); }
    if (q.to)   { params.push(q.to);   where.push(`plr.created_at <= $${params.length}`); }

    const r = await pool.query(`
      SELECT plr.*, c.name AS client_name, c.card_pct,
             u.name AS created_by_name
        FROM payment_link_requests plr
        LEFT JOIN clients c ON c.id = plr.client_id
        LEFT JOIN users   u ON u.id = plr.created_by
       WHERE ${where.join(' AND ')}
       ORDER BY plr.created_at DESC
       LIMIT 10000
    `, params);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payment-links-${new Date().toISOString().slice(0,10)}.csv"`);
    const headers = ['id','token','status','amount','currency','description','customer_email','customer_name','client_name','created_by_name','created_at','expires_at','paid_at','attempts','url'];
    if (canSeeFee(req.user)) headers.push('fp_fee');
    res.write(headers.join(',') + '\n');
    for (const row of r.rows) {
      const url = publicUrlFromToken(row.token);
      const fee = canSeeFee(req.user)
        ? (row.amount == null ? '' : (row.amount * (parseFloat(row.card_pct) || 0)).toFixed(2))
        : null;
      const fields = [
        row.id, row.token || '', row.status, row.amount, row.currency || 'USD',
        row.description, row.customer_email, row.customer_name,
        row.client_name, row.created_by_name,
        row.created_at?.toISOString?.() || row.created_at,
        row.expires_at?.toISOString?.() || row.expires_at || '',
        row.paid_at?.toISOString?.()    || row.paid_at    || '',
        row.attempts || 0,
        url || '',
      ];
      if (canSeeFee(req.user)) fields.push(fee);
      res.write(fields.map(csvCell).join(',') + '\n');
    }
    res.end();
  } catch (err) {
    console.error('[paymentLinks export.csv]', err);
    res.status(500).json({ error: err.message });
  }
});

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ━━━ POST / — create (legacy shape preserved) ───────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.client_id || !b.amount) return res.status(400).json({ error: 'client_id and amount required' });
    const r = await pool.query(`
      INSERT INTO payment_link_requests
        (client_id, customer_name, customer_email, customer_phone, amount, currency,
         description, invoice_number, payment_method, entity_id, merchant_id,
         status, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,COALESCE($6,'USD'),$7,$8,$9,$10,$11,COALESCE($12,'requested'),$13,$14)
      RETURNING *
    `, [
      b.client_id, b.customer_name || null, b.customer_email || null, b.customer_phone || null,
      b.amount, b.currency, b.description || null, b.invoice_number || null,
      b.payment_method || null, b.entity_id || null, b.merchant_id || null,
      b.status, b.notes || null, req.user.id,
    ]);

    await logAudit({
      action: 'payment_link.created',
      entityType: 'payment_link_requests',
      entityId: r.rows[0].id,
      userId: req.user.id,
      metadata: { amount: b.amount, client_id: b.client_id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /:id — detail with timeline ─────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const params = [req.params.id];
    let where = 'plr.id = $1';
    if (req.user.role === 'client_user' && req.user.client_id) {
      params.push(req.user.client_id);
      where += ` AND plr.client_id = $${params.length}`;
    }
    const r = await pool.query(`
      SELECT plr.*, c.name AS client_name, c.card_pct,
             e.legal_name AS entity_name,
             m.processor_name,
             u.name AS created_by_name, u.role AS created_by_role
        FROM payment_link_requests plr
        LEFT JOIN clients   c ON c.id = plr.client_id
        LEFT JOIN entities  e ON e.id = plr.entity_id
        LEFT JOIN merchants m ON m.id = plr.merchant_id
        LEFT JOIN users     u ON u.id = plr.created_by
       WHERE ${where}
    `, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });

    const tl = await pool.query(`
      SELECT al.id, al.action, al.new_value, al.created_at,
             al.user_id, u.name AS user_name, u.role AS user_role
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
       WHERE al.resource = 'payment_link_requests' AND al.resource_id = $1
       ORDER BY al.created_at ASC
    `, [String(req.params.id)]);

    res.json({
      link: rowToResult(r.rows[0], req.user),
      timeline: tl.rows.map((e) => ({
        id: e.id,
        action: e.action,
        at: e.created_at,
        actor: e.user_id ? { id: e.user_id, name: e.user_name, role: e.user_role } : null,
        metadata: e.new_value,
      })),
    });
  } catch (err) {
    console.error('[paymentLinks GET /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ PATCH /:id — partial update (legacy shape preserved + audit) ─
router.patch('/:id', async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const b = req.body || {};
    const fields = ['customer_name','customer_email','customer_phone','amount','currency','description',
      'invoice_number','payment_method','entity_id','merchant_id','processor_link',
      'status','screenshot_url','transaction_id','notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (b.processor_link !== undefined) { sets.push(`link_generated_at = NOW()`); }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE payment_link_requests SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });

    await logAudit({
      action: 'payment_link.edited',
      entityType: 'payment_link_requests',
      entityId: req.params.id,
      userId: req.user.id,
      metadata: { changed: Object.keys(b) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /:id/cancel ────────────────────────────────────────
router.post('/:id/cancel', async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const r = await pool.query(
      `UPDATE payment_link_requests
          SET status = 'cancelled'
        WHERE id = $1
          AND status NOT IN ('paid','cancelled','refunded')
        RETURNING id, status`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(409).json({ error: 'Cannot cancel — link is paid, already cancelled, or not found' });

    await logAudit({
      action: 'payment_link.cancelled',
      entityType: 'payment_link_requests',
      entityId: req.params.id,
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /:id/resend-email ──────────────────────────────────
router.post('/:id/resend-email', async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const r = await pool.query(`
      SELECT plr.*, c.name AS client_name
        FROM payment_link_requests plr
        LEFT JOIN clients c ON c.id = plr.client_id
       WHERE plr.id = $1
    `, [req.params.id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!row.customer_email) return res.status(400).json({ error: 'No customer email on file' });

    const url = publicUrlFromToken(row.token) || row.processor_link || null;
    if (!url) return res.status(400).json({ error: 'Link has no token yet — regenerate from Virtual Terminal' });

    try {
      await email.sendPaymentLinkToClient(
        row.customer_email,
        row.customer_name || row.client_name || 'Customer',
        url,
        row.amount,
        row.description
      );
    } catch (e) {
      console.warn('[paymentLinks resend-email] send failed:', e.message);
      return res.status(502).json({ error: `Email send failed: ${e.message}` });
    }

    await logAudit({
      action: 'payment_link.email_resent',
      entityType: 'payment_link_requests',
      entityId: req.params.id,
      userId: req.user.id,
      metadata: { to: row.customer_email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, sent_to: row.customer_email });
  } catch (err) {
    console.error('[paymentLinks resend-email]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /:id/qr.png ─────────────────────────────────────────
router.get('/:id/qr.png', async (req, res) => {
  try {
    const params = [req.params.id];
    let where = 'plr.id = $1';
    if (req.user.role === 'client_user' && req.user.client_id) {
      params.push(req.user.client_id);
      where += ` AND plr.client_id = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT token, processor_link FROM payment_link_requests plr WHERE ${where}`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const url = publicUrlFromToken(r.rows[0].token) || r.rows[0].processor_link;
    if (!url) return res.status(409).json({ error: 'Link has no URL yet' });

    const png = await QRCode.toBuffer(url, {
      type: 'png',
      width: 480,
      margin: 2,
      color: { dark: '#7C3AED', light: '#FFFFFF' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.end(png);
  } catch (err) {
    console.error('[paymentLinks qr.png]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
