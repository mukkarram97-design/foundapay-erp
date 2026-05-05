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
    const r = await pool.query(`
      SELECT cb.*, c.name AS client_name, m.processor_name,
             CASE WHEN cb.evidence_deadline IS NOT NULL
                  THEN (cb.evidence_deadline - CURRENT_DATE)::int
                  ELSE NULL END AS days_to_deadline
        FROM chargebacks cb
        LEFT JOIN clients c ON c.id = cb.client_id
        LEFT JOIN merchants m ON m.id = cb.merchant_id
       ORDER BY cb.created_at DESC
    `);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(`
      INSERT INTO chargebacks
        (transaction_id, client_id, merchant_id, customer_name, amount, cb_fee,
         reason, evidence_deadline, status, notes)
      VALUES ($1,$2,$3,$4,$5,COALESCE($6::numeric,0),$7,$8,COALESCE($9,'open'),$10)
      RETURNING *
    `, [
      b.transaction_id || null, b.client_id || null, b.merchant_id || null,
      b.customer_name || null, b.amount, b.cb_fee, b.reason || null,
      b.evidence_deadline || null, b.status, b.notes || null,
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['transaction_id','client_id','merchant_id','customer_name','amount','cb_fee',
      'reason','evidence_deadline','evidence_uploaded','result','status','notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(`UPDATE chargebacks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
