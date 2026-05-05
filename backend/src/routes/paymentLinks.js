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
      SELECT plr.*, c.name AS client_name, e.legal_name AS entity_name, m.processor_name
        FROM payment_link_requests plr
        LEFT JOIN clients c ON c.id = plr.client_id
        LEFT JOIN entities e ON e.id = plr.entity_id
        LEFT JOIN merchants m ON m.id = plr.merchant_id
        ORDER BY plr.created_at DESC
    `);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
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
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
