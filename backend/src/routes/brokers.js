const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

// GET /api/brokers — with computed earnings
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT b.*, c.name AS client_name,
             COALESCE((
               SELECT SUM(
                 CASE b.basis
                   WHEN 'gross_received' THEN t.gross_amount
                   WHEN 'revenue'        THEN t.fee_amount
                   WHEN 'net_to_client'  THEN t.net_amount
                   ELSE t.gross_amount
                 END
               )
               FROM transactions t
              WHERE t.client_id = b.managed_client_id
                AND t.type = 'Received'
                AND t.date_received BETWEEN '2026-04-01' AND '2026-04-30'
             ), 0) AS april_basis,
             COALESCE((
               SELECT SUM(amount) FROM broker_payments WHERE broker_id = b.id
             ), 0) AS total_paid
        FROM brokers b
        LEFT JOIN clients c ON c.id = b.managed_client_id
        ORDER BY b.created_at DESC
    `);
    const rows = r.rows.map(b => ({
      ...b,
      april_earnings: +(parseFloat(b.april_basis) * parseFloat(b.commission_pct)).toFixed(2),
      balance_owed: +(parseFloat(b.april_basis) * parseFloat(b.commission_pct) - parseFloat(b.total_paid)).toFixed(2),
    }));
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`
      INSERT INTO brokers (name, email, phone, managed_client_id, commission_pct, basis, status, notes)
      VALUES ($1,$2,$3,$4,COALESCE($5::numeric,0.01),COALESCE($6,'gross_received'),COALESCE($7,'active'),$8)
      RETURNING *
    `, [b.name, b.email || null, b.phone || null, b.managed_client_id || null,
        b.commission_pct, b.basis, b.status, b.notes || null]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['name','email','phone','managed_client_id','commission_pct','basis','status','notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE brokers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brokers/:id/pay — record a payment
router.post('/:id/pay', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(`
      INSERT INTO broker_payments (broker_id, period, amount, reference, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [req.params.id, b.period || null, parseFloat(b.amount) || 0, b.reference || null, b.notes || null, req.user.id]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/payments', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM broker_payments WHERE broker_id = $1 ORDER BY paid_at DESC',
      [req.params.id]
    );
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
