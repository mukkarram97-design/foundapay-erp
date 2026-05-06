// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// User permissions admin API.
//
//   GET  /api/permissions/me          — caller's own permissions + usage (any role)
//   GET  /api/permissions/:userId     — admin/super: full perms for a user
//   POST /api/permissions/:userId     — admin/super: create or upsert perms
//   GET  /api/permissions/:userId/usage — admin/super or owner: current period usage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { getUserPermissions, getCurrentUsage } = require('../services/permissions');

const router = express.Router();
router.use(authRequired);

const ADMIN_ROLES = ['super_admin', 'owner', 'admin'];
function requireAdmin(req, res, next) {
  if (!ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
  next();
}

// GET /me — own perms + usage (used by sidebar and client-portal limit display)
router.get('/me', async (req, res) => {
  try {
    const perms = await getUserPermissions(req.user.id, req.user.role);
    const usage = perms?.show_usage_to_user || perms?._superAllowAll
      ? await getCurrentUsage(req.user.id, perms)
      : null;
    res.json({ permissions: perms, usage });
  } catch (err) {
    console.error('[permissions /me]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /:userId — admin view of any user's perms + usage
router.get('/:userId', requireAdmin, async (req, res) => {
  try {
    const userR = await pool.query('SELECT id, name, email, role, client_id FROM users WHERE id = $1', [req.params.userId]);
    if (!userR.rows.length) return res.status(404).json({ error: 'User not found' });
    const u = userR.rows[0];
    const perms = await getUserPermissions(u.id, u.role); // pass *target* role, not caller's
    // For non-super target users we still want the raw row (no allow-all overlay):
    const raw = await pool.query('SELECT * FROM user_permissions WHERE user_id = $1', [u.id]);
    const usage = await getCurrentUsage(u.id, raw.rows[0] || perms);
    res.json({
      user: u,
      permissions: raw.rows[0] || null,
      effective: perms, // useful for explaining super-admin bypass
      usage,
    });
  } catch (err) {
    console.error('[permissions get]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /:userId — upsert
router.post('/:userId', requireAdmin, async (req, res) => {
  try {
    const userR = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.userId]);
    if (!userR.rows.length) return res.status(404).json({ error: 'User not found' });

    const b = req.body || {};
    // Whitelist of writable columns
    const cols = [
      'can_virtual_terminal','can_payment_links','can_invoices','can_master_ledger',
      'can_reports','can_payouts','can_reconciliation','can_bank_accounts',
      'can_remittance','can_clients','can_chargebacks','can_reserves',
      'can_expenses','can_approvals',
      'vt_direct_charge','vt_payment_links','vt_invoices',
      'vt_limit_per_transaction','vt_limit_daily','vt_limit_monthly',
      'vt_max_links_per_day','vt_max_links_per_month',
      'vt_link_max_amount','vt_link_auto_expire_hours',
      'limit_action','limit_reset_type',
      'see_own_data_only','client_id','show_usage_to_user',
    ];
    const fields = ['user_id'];
    const values = [req.params.userId];
    const placeholders = ['$1'];
    for (const c of cols) {
      if (b[c] !== undefined) {
        values.push(b[c]);
        fields.push(c);
        placeholders.push(`$${values.length}`);
      }
    }
    // vt_merchants is JSONB
    if (b.vt_merchants !== undefined) {
      values.push(JSON.stringify(b.vt_merchants || []));
      fields.push('vt_merchants');
      placeholders.push(`$${values.length}::jsonb`);
    }
    values.push(req.user.id);
    fields.push('configured_by');
    placeholders.push(`$${values.length}`);

    const updates = fields.slice(1).map((f, i) => `${f} = EXCLUDED.${f}`).join(', ');

    const sql = `
      INSERT INTO user_permissions (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (user_id) DO UPDATE
         SET ${updates}, configured_at = NOW(), updated_at = NOW()
      RETURNING *
    `;
    const r = await pool.query(sql, values);

    await logAudit({
      action: 'user.permissions_updated',
      entityType: 'user_permissions', entityId: req.params.userId,
      userId: req.user.id,
      metadata: { fields: Object.keys(b) },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[permissions upsert]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /:userId/usage — read-only
router.get('/:userId/usage', requireAdmin, async (req, res) => {
  try {
    const userR = await pool.query('SELECT id, role FROM users WHERE id = $1', [req.params.userId]);
    if (!userR.rows.length) return res.status(404).json({ error: 'User not found' });
    const raw = await pool.query('SELECT * FROM user_permissions WHERE user_id = $1', [req.params.userId]);
    const usage = await getCurrentUsage(req.params.userId, raw.rows[0] || null);
    const limits = raw.rows[0] || null;
    let pct = { daily: 0, monthly: 0 };
    if (limits) {
      pct.daily   = limits.vt_limit_daily   > 0 ? Math.min(100, Math.round((usage.charged.today / parseFloat(limits.vt_limit_daily)) * 100)) : 0;
      pct.monthly = limits.vt_limit_monthly > 0 ? Math.min(100, Math.round((usage.charged.this_period / parseFloat(limits.vt_limit_monthly)) * 100)) : 0;
    }
    res.json({ usage, limits, percentage_used: pct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
