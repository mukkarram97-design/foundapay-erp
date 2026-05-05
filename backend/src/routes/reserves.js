const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

router.get('/', async (req, res) => {
  try {
    const { status, client_id } = req.query;
    const where = []; const params = [];
    if (status)    { params.push(status);    where.push(`r.status = $${params.length}`); }
    if (client_id) { params.push(client_id); where.push(`r.client_id = $${params.length}`); }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT r.*, c.name AS client_name, m.processor_name
        FROM reserves r
        LEFT JOIN clients c ON c.id = r.client_id
        LEFT JOIN merchants m ON m.id = r.merchant_id
        ${whereSQL}
        ORDER BY r.hold_date DESC
    `, params);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/release', async (req, res) => {
  try {
    const amount = parseFloat(req.body?.amount);
    const cur = await pool.query('SELECT * FROM reserves WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const reserve = cur.rows[0];
    const releaseAmount = amount || (reserve.amount - reserve.released_amount);
    const newReleased = parseFloat(reserve.released_amount) + releaseAmount;
    const status = newReleased >= reserve.amount ? 'released' : 'partially_released';
    const r = await pool.query(`
      UPDATE reserves
         SET released_amount = $1, status = $2, release_date = COALESCE(release_date, CURRENT_DATE)
       WHERE id = $3 RETURNING *
    `, [newReleased, status, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(`
      INSERT INTO reserves
        (transaction_id, client_id, merchant_id, amount, bearer, reserve_type, hold_date, status)
      VALUES ($1,$2,$3,$4,COALESCE($5,'Client'),$6,COALESCE($7, CURRENT_DATE),'held')
      RETURNING *
    `, [
      b.transaction_id || null, b.client_id || null, b.merchant_id || null,
      b.amount, b.bearer, b.reserve_type || null, b.hold_date || null,
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
