const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const email = require('../services/email');

const router = express.Router();
router.use(authRequired);
router.use(requireRole('super_admin', 'owner', 'admin'));

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

module.exports = router;
