// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Merchants — list, create, update, logo, health-check, soft-delete.
//
// Compatibility:
//   - Existing list/POST/PATCH endpoints kept; added new fields are returned.
//   - POST /route still uses the routing engine.
//   - Soft-delete (is_deleted=true) hides rows from list responses.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { rankMerchants } = require('../services/routingEngine');
const { runHealthCheck } = require('../services/processors/healthCheck');
const { logAudit } = require('../services/audit');

const router = express.Router();
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

// Logo upload setup
const LOGO_DIR = '/var/www/foundapay/uploads/merchants';
try { fs.mkdirSync(LOGO_DIR, { recursive: true }); } catch { /* dir exists or perms */ }

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: LOGO_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname).toLowerCase() || '.png').slice(0, 6);
      cb(null, `merchant-${req.params.id}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type. PNG, JPG, or SVG only.'));
    }
    cb(null, true);
  },
});

// Sanitize creds before returning to non-super users (mask secrets).
function maskCredentials(creds, role) {
  if (!creds || typeof creds !== 'object') return {};
  if (SUPER_ROLES.includes(role)) return creds;
  const out = {};
  for (const [k, v] of Object.entries(creds)) {
    if (!v) continue;
    const s = String(v);
    out[k] = s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : '***';
  }
  return out;
}

function rowToResult(row, role) {
  return {
    ...row,
    api_credentials: maskCredentials(row.api_credentials, role),
  };
}

// ━━━ GET / — list ━━━
// ?active=true       → only is_live merchants
// ?client_id=<uuid>  → only merchants assigned to that client via
//                      client_merchants. Each row gets joined fields:
//                      cm_is_default, cm_can_direct_charge, cm_can_generate_links,
//                      cm_can_generate_invoices, cm_per_transaction_limit, etc.
//                      If the client has no rows in client_merchants, returns
//                      [] (empty list) — frontend should warn.
router.get('/', async (req, res) => {
  try {
    // ?active=true was originally a hard filter to is_live merchants. Staff
    // (super_admin/owner/admin/finance_manager) need to see EVERY merchant in
    // the VT picker — including sandbox + not-yet-live rows — so the flag
    // is now treated as a soft hint and ignored for staff. Client_user
    // requests still respect it: they should never be charging through an
    // is_live=false processor.
    const role = req.user?.role;
    const isStaff = ['super_admin', 'owner', 'admin', 'finance_manager'].includes(role);
    const onlyActive = req.query.active === 'true' && !isStaff;
    const clientId = req.query.client_id || null;
    const where = ['m.is_deleted = false'];
    const params = [];
    if (onlyActive) where.push(`m.is_live = true`);
    if (clientId) {
      params.push(clientId);
      where.push(`cm.client_id = $${params.length}`);
    }

    const join = clientId
      ? 'INNER JOIN client_merchants cm ON cm.merchant_id = m.id'
      : 'LEFT JOIN client_merchants cm ON cm.merchant_id = m.id AND cm.client_id = NULL'; // never matches → all NULLs

    // Order: live first (so VT default lands on a live row), then by entity
    // name for grouped-dropdown rendering, then merchant name within each group.
    const orderBy = clientId
      ? 'cm.is_default DESC, m.is_live DESC, m.processor_name'
      : 'm.is_live DESC, e.legal_name NULLS LAST, m.processor_name';

    const r = await pool.query(`
      SELECT m.*, e.legal_name AS entity_name, e.owner_name AS entity_owner_name,
             b.bank_name,
             cm.is_default              AS cm_is_default,
             cm.can_direct_charge       AS cm_can_direct_charge,
             cm.can_generate_links      AS cm_can_generate_links,
             cm.can_generate_invoices   AS cm_can_generate_invoices,
             cm.per_transaction_limit   AS cm_per_transaction_limit,
             cm.daily_limit             AS cm_daily_limit,
             cm.monthly_limit           AS cm_monthly_limit
        FROM merchants m
        LEFT JOIN entities e       ON e.id = m.entity_id
        LEFT JOIN bank_accounts b  ON b.id = m.bank_account_id
        ${join}
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
    `, params);
    res.json({ rows: r.rows.map((row) => rowToResult(row, req.user.role)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /:id ━━━
router.get('/:id', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT m.*, e.legal_name AS entity_name, b.bank_name
        FROM merchants m
        LEFT JOIN entities e ON e.id = m.entity_id
        LEFT JOIN bank_accounts b ON b.id = m.bank_account_id
       WHERE m.id = $1 AND m.is_deleted = false
    `, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rowToResult(r.rows[0], req.user.role));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST / — create (super admin) ━━━
router.post('/', requireSuper, async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    if (!b.processor_name && !b.name) return res.status(400).json({ error: 'processor_name required' });

    await c.query('BEGIN');
    const r = await c.query(`
      INSERT INTO merchants
        (processor_name, account_name, entity_id, bank_account_id, mid,
         processing_fee_pct, fixed_fee, reserve_pct, chargeback_fee, settlement_delay_days,
         daily_limit, monthly_limit, availability, risk_status, supported_methods, notes,
         processor_type, is_sandbox, monthly_volume_cap, supported_methods_json,
         contact_name, contact_email, contact_phone, api_credentials)
      VALUES ($1,$2,$3,$4,$5,COALESCE($6::numeric,0),COALESCE($7::numeric,0),COALESCE($8::numeric,0),
              COALESCE($9::numeric,0),COALESCE($10::int,2),
              $11,$12,COALESCE($13,'available'),COALESCE($14,'normal'),
              $15,$16,
              COALESCE($17,'authnet'), COALESCE($18,false), COALESCE($19::numeric,0),
              COALESCE($20::jsonb,'["cards"]'::jsonb),
              $21,$22,$23, COALESCE($24::jsonb,'{}'::jsonb))
      RETURNING *
    `, [
      b.processor_name || b.name, b.account_name || null, b.entity_id || null,
      b.bank_account_id || null, b.mid || null,
      b.processing_fee_pct, b.fixed_fee, b.reserve_pct, b.chargeback_fee, b.settlement_delay_days,
      b.daily_limit || null, b.monthly_limit || null, b.availability, b.risk_status,
      b.supported_methods || null, b.notes || null,
      b.processor_type || 'authnet', !!b.is_sandbox, b.monthly_volume_cap || 0,
      b.supported_methods ? JSON.stringify(b.supported_methods) : null,
      b.contact_name || null, b.contact_email || null, b.contact_phone || null,
      b.api_credentials ? JSON.stringify(b.api_credentials) : null,
    ]);
    const created = r.rows[0];

    // Auto run health check; if it returns healthy, flip is_live=true.
    let healthResult = await runHealthCheck(created.processor_type, created.api_credentials, { isSandbox: created.is_sandbox });
    await c.query(`
      UPDATE merchants
         SET health_status = $1, health_message = $2, health_checked_at = NOW(),
             is_live = (is_live OR $3::boolean), updated_at = NOW()
       WHERE id = $4
    `, [healthResult.status, healthResult.message || null, healthResult.status === 'healthy' || healthResult.status === 'slow', created.id]);

    await c.query('COMMIT');

    await logAudit({
      action: 'merchant.created', entityType: 'merchants', entityId: created.id,
      userId: req.user.id,
      metadata: { name: created.processor_name, processor_type: created.processor_type, health: healthResult.status },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    const final = await pool.query('SELECT * FROM merchants WHERE id = $1', [created.id]);
    res.status(201).json({ merchant: rowToResult(final.rows[0], req.user.role), healthResult });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[merchants create]', err);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ PUT /:id — full update (super admin); re-runs health check if creds changed ━━━
router.put('/:id', requireSuper, async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    const fields = ['processor_name', 'account_name', 'entity_id', 'bank_account_id', 'mid',
      'processing_fee_pct', 'fixed_fee', 'reserve_pct', 'chargeback_fee', 'settlement_delay_days',
      'daily_limit', 'monthly_limit', 'availability', 'risk_status', 'supported_methods', 'notes',
      'processor_type', 'is_sandbox', 'monthly_volume_cap',
      'contact_name', 'contact_email', 'contact_phone', 'is_live'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    let credsChanged = false;
    if (b.api_credentials !== undefined) {
      params.push(JSON.stringify(b.api_credentials));
      sets.push(`api_credentials = $${params.length}::jsonb`);
      credsChanged = true;
    }
    if (b.supported_methods_json !== undefined) {
      params.push(JSON.stringify(b.supported_methods_json));
      sets.push(`supported_methods_json = $${params.length}::jsonb`);
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);

    await c.query('BEGIN');
    const r = await c.query(
      `UPDATE merchants SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} AND is_deleted = false RETURNING *`, params);
    if (!r.rows.length) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    let healthResult = null;
    if (credsChanged) {
      healthResult = await runHealthCheck(r.rows[0].processor_type, r.rows[0].api_credentials, { isSandbox: r.rows[0].is_sandbox });
      await c.query(`
        UPDATE merchants
           SET health_status = $1, health_message = $2, health_checked_at = NOW(), updated_at = NOW()
         WHERE id = $3
      `, [healthResult.status, healthResult.message || null, req.params.id]);
    }
    await c.query('COMMIT');

    await logAudit({
      action: 'merchant.updated', entityType: 'merchants', entityId: req.params.id,
      userId: req.user.id, metadata: { fields: Object.keys(b), creds_changed: credsChanged },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    const final = await pool.query('SELECT * FROM merchants WHERE id = $1', [req.params.id]);
    res.json({ merchant: rowToResult(final.rows[0], req.user.role), healthResult });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[merchants update]', err);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ PATCH /:id — preserved for legacy call sites ━━━
router.patch('/:id', requireSuper, async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['processor_name', 'account_name', 'entity_id', 'bank_account_id', 'mid',
      'processing_fee_pct', 'fixed_fee', 'reserve_pct', 'chargeback_fee', 'settlement_delay_days',
      'daily_limit', 'monthly_limit', 'availability', 'risk_status', 'chargeback_rate',
      'supported_methods', 'notes',
      'processor_type', 'is_sandbox', 'monthly_volume_cap',
      'contact_name', 'contact_email', 'contact_phone', 'is_live'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE merchants SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} AND is_deleted = false RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rowToResult(r.rows[0], req.user.role));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /:id/logo ━━━
router.post('/:id/logo', requireSuper, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    if (req.file.mimetype === 'image/svg+xml') {
      const content = fs.readFileSync(req.file.path, 'utf8');
      if (/<\s*script/i.test(content) || /\bon\w+\s*=/i.test(content) || /javascript:/i.test(content)) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: 'SVG contains scripts — rejected' });
      }
    }

    const filename = path.basename(req.file.path);
    const logoUrl = `/uploads/merchants/${filename}`;
    await pool.query(`
      UPDATE merchants SET logo_url = $1, logo_uploaded_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND is_deleted = false
    `, [logoUrl, req.params.id]);

    await logAudit({
      action: 'merchant.logo_uploaded', entityType: 'merchants', entityId: req.params.id,
      userId: req.user.id, metadata: { logo_url: logoUrl, mimetype: req.file.mimetype, size: req.file.size },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.json({ logo_url: logoUrl });
  } catch (err) {
    console.error('[merchants logo]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /:id/health-check ━━━
router.post('/:id/health-check', requireSuper, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, processor_type, api_credentials, is_sandbox FROM merchants WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const m = r.rows[0];

    const result = await runHealthCheck(m.processor_type, m.api_credentials, { isSandbox: m.is_sandbox });
    await pool.query(`
      UPDATE merchants SET health_status = $1, health_message = $2, health_checked_at = NOW(), updated_at = NOW()
       WHERE id = $3
    `, [result.status, result.message || null, req.params.id]);

    await logAudit({
      action: 'merchant.health_check', entityType: 'merchants', entityId: req.params.id,
      userId: req.user.id, metadata: { status: result.status, latency: result.latency, message: result.message },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.json(result);
  } catch (err) {
    console.error('[merchants health]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ DELETE /:id — soft delete (super admin), block if active txns last 30d ━━━
router.delete('/:id', requireSuper, async (req, res) => {
  try {
    const cur = await pool.query(
      'SELECT id, processor_name FROM merchants WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });

    const recent = await pool.query(`
      SELECT COUNT(*)::int AS n FROM transactions
       WHERE merchant_id = $1 AND is_deleted = false
         AND created_at > NOW() - INTERVAL '30 days'
    `, [req.params.id]);
    if (recent.rows[0].n > 0) {
      return res.status(409).json({ error: `Cannot delete — ${recent.rows[0].n} active transactions in last 30 days` });
    }

    await pool.query('UPDATE merchants SET is_deleted = true, updated_at = NOW() WHERE id = $1', [req.params.id]);
    await logAudit({
      action: 'merchant.deleted', entityType: 'merchants', entityId: req.params.id,
      userId: req.user.id, metadata: { name: cur.rows[0].processor_name },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /route — preserved ━━━
router.post('/route', async (req, res) => {
  try {
    const { amount, method } = req.body || {};
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const r = await pool.query(`
      SELECT m.*, e.legal_name AS entity_name FROM merchants m
        LEFT JOIN entities e ON e.id = m.entity_id
       WHERE m.is_deleted = false
    `);
    const ranked = rankMerchants(r.rows, parseFloat(amount), method);
    res.json({ ranked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
