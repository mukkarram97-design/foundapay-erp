const express = require('express');
const { pool } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);
router.use(requireRole('super_admin', 'owner', 'admin', 'auditor'));

router.get('/', async (req, res) => {
  try {
    const { user_id, action, resource, from, to, limit = 200 } = req.query;
    const where = []; const params = [];
    if (user_id)  { params.push(user_id);  where.push(`a.user_id = $${params.length}`); }
    if (action)   { params.push(action);   where.push(`a.action = $${params.length}`); }
    if (resource) { params.push(resource); where.push(`a.resource = $${params.length}`); }
    if (from)     { params.push(from);     where.push(`a.created_at >= $${params.length}`); }
    if (to)       { params.push(to);       where.push(`a.created_at <= $${params.length}`); }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const r = await pool.query(`
      SELECT a.*, u.email AS user_email, u.name AS user_name
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        ${whereSQL}
        ORDER BY a.created_at DESC LIMIT $${params.length}
    `, params);

    const lh = await pool.query(`
      SELECT lh.*, u.email AS user_email, u.name AS user_name
        FROM login_history lh LEFT JOIN users u ON u.id = lh.user_id
        ORDER BY lh.created_at DESC LIMIT 50
    `);

    res.json({ rows: r.rows, login_history: lh.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
