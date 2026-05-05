const express = require('express');
const { pool } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value, updated_at FROM cms_settings ORDER BY key');
    const obj = {};
    for (const row of r.rows) obj[row.key] = row.value;
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:key', requireRole('super_admin', 'owner', 'admin'), async (req, res) => {
  try {
    const { value } = req.body || {};
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    const r = await pool.query(`
      INSERT INTO cms_settings (key, value, updated_by, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING *
    `, [req.params.key, JSON.stringify(value), req.user.id]);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
