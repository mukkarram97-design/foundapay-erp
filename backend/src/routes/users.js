const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const email = require('../services/email');

const router = express.Router();
router.use(authRequired);
router.use(requireRole('super_admin', 'owner', 'admin'));

// Inline guard: must be super_admin OR admin (excludes owner) — used by toggle/resend
function requireSuperOrAdmin(req, res, next) {
  if (!['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden: super_admin or admin required' });
  }
  next();
}

// ── GET /api/users ───────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT u.id, u.email, u.name, u.role, u.is_active, u.client_id, u.last_login, u.login_count,
             u.created_at, c.name AS client_name
        FROM users u
        LEFT JOIN clients c ON c.id = u.client_id
        ORDER BY u.created_at DESC
    `);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/users ──────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.email || !b.role) return res.status(400).json({ error: 'email and role required' });
    if (b.role === 'client_user' && !b.client_id) {
      return res.status(400).json({ error: 'client_id required for client_user role' });
    }
    const tempPass = b.password || (Math.random().toString(36).slice(-10) + 'A1!');
    const hash = await bcrypt.hash(tempPass, 10);
    const r = await pool.query(`
      INSERT INTO users (email, password_hash, name, role, phone, client_id, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,true)
      RETURNING id, email, name, role, client_id
    `, [b.email.toLowerCase(), hash, b.name || null, b.role, b.phone || null, b.client_id || null]);

    if (b.send_welcome !== false) {
      email.sendWelcome(b.email, b.name || b.email, tempPass).catch(() => {});
    }
    res.status(201).json({ user: r.rows[0], temp_password: b.password ? undefined : tempPass });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/users/:id ─────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['email','name','role','phone','is_active','client_id'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (b.password) {
      const hash = await bcrypt.hash(b.password, 10);
      params.push(hash); sets.push(`password_hash = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}
       RETURNING id, email, name, role, is_active, client_id`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/users/:id/toggle-active ───────────────────────
// super_admin or admin; cannot deactivate self or any super_admin
router.patch('/:id/toggle-active', requireSuperOrAdmin, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      return res.status(403).json({ error: 'Cannot deactivate yourself' });
    }
    const cur = await pool.query(
      'SELECT id, name, email, role, is_active FROM users WHERE id = $1',
      [targetId]
    );
    if (!cur.rows.length) return res.status(404).json({ error: 'User not found' });
    const target = cur.rows[0];
    if (target.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot toggle a super_admin' });
    }
    const newActive = !target.is_active;
    await pool.query(
      'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2',
      [newActive, targetId]
    );
    // Invalidate any active reset tokens if deactivating
    if (!newActive) {
      await pool.query(
        'UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false',
        [targetId]
      );
    }
    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource, resource_id, old_value, new_value, ip_address)
      VALUES ($1, $2, 'users', $3, $4, $5, $6)
    `, [
      req.user.id,
      newActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      targetId,
      JSON.stringify({ is_active: target.is_active }),
      JSON.stringify({ is_active: newActive }),
      req.ip || null,
    ]);
    res.json({
      id: target.id,
      name: target.name,
      is_active: newActive,
      message: newActive ? 'User activated' : 'User deactivated',
    });
  } catch (err) {
    console.error('[users/toggle-active]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/users/:id ────────────────────────────────────
// super_admin only; soft-delete (preserves audit trail)
router.delete('/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      return res.status(403).json({ error: 'Cannot delete yourself' });
    }
    const cur = await pool.query(
      'SELECT id, name, email, role, is_active FROM users WHERE id = $1',
      [targetId]
    );
    if (!cur.rows.length) return res.status(404).json({ error: 'User not found' });
    const target = cur.rows[0];
    if (target.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot delete another super_admin' });
    }
    const deletedEmail = `deleted_${targetId}@deleted.com`;
    await pool.query(`
      UPDATE users
         SET is_active = false,
             email = $1,
             updated_at = NOW()
       WHERE id = $2
    `, [deletedEmail, targetId]);
    // Invalidate sessions/reset tokens
    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false',
      [targetId]
    );
    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource, resource_id, old_value, ip_address)
      VALUES ($1, 'DELETE_USER', 'users', $2, $3, $4)
    `, [req.user.id, targetId, JSON.stringify(target), req.ip || null]);
    res.json({
      message: `User ${target.name || target.email} deleted`,
      id: targetId,
    });
  } catch (err) {
    console.error('[users/delete]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/users/:id/resend-invite ────────────────────────
// super_admin or admin; rotates password, sends welcome email
router.post('/:id/resend-invite', requireSuperOrAdmin, async (req, res) => {
  try {
    const targetId = req.params.id;
    const cur = await pool.query(
      'SELECT id, email, name, is_active FROM users WHERE id = $1',
      [targetId]
    );
    if (!cur.rows.length) return res.status(404).json({ error: 'User not found' });
    const target = cur.rows[0];
    if (!target.is_active) {
      return res.status(400).json({ error: 'User is inactive — activate first' });
    }
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const newHash = await bcrypt.hash(tempPassword, 12);
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, targetId]
    );
    await pool.query(`
      INSERT INTO audit_logs (user_id, action, resource, resource_id, ip_address)
      VALUES ($1, 'RESEND_INVITE', 'users', $2, $3)
    `, [req.user.id, targetId, req.ip || null]);

    // Fire-and-forget email — never fail the request because of mail
    email.sendWelcome(target.email, target.name || target.email, tempPassword).catch((e) => {
      console.warn('[users/resend-invite] email send failed:', e.message);
    });

    res.json({
      message: `Invite resent to ${target.email}`,
      // expose the new temp password to the admin in case the email never arrives
      temp_password: tempPassword,
    });
  } catch (err) {
    console.error('[users/resend-invite]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
