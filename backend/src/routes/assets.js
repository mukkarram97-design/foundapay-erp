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
      SELECT a.*, c.nickname AS card_nickname, c.last4 AS card_last4,
             e.legal_name AS entity_name, cl.name AS client_name,
             CASE WHEN a.renewal_date IS NOT NULL
                  THEN (a.renewal_date - CURRENT_DATE)::int
                  ELSE NULL END AS days_to_renewal
        FROM assets a
        LEFT JOIN cards c ON c.id = a.card_id
        LEFT JOIN entities e ON e.id = a.entity_id
        LEFT JOIN clients cl ON cl.id = a.client_id
        ORDER BY a.renewal_date NULLS LAST, a.name
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
      INSERT INTO assets
        (name, asset_type, vendor, purchase_date, purchase_amount, card_id, entity_id,
         ownership_type, client_id, is_recurring, renewal_date, annual_cost,
         renewal_alert_days, status, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'internal'),$9,COALESCE($10,false),
              $11,$12,COALESCE($13,30),COALESCE($14,'active'),$15,$16)
      RETURNING *
    `, [
      b.name, b.asset_type || 'other', b.vendor || null, b.purchase_date || null, b.purchase_amount || null,
      b.card_id || null, b.entity_id || null, b.ownership_type, b.client_id || null,
      b.is_recurring, b.renewal_date || null, b.annual_cost || null,
      b.renewal_alert_days, b.status, b.notes || null, req.user.id,
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['name','asset_type','vendor','purchase_date','purchase_amount','card_id','entity_id',
      'ownership_type','client_id','is_recurring','renewal_date','annual_cost',
      'renewal_alert_days','status','notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(`UPDATE assets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM assets WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
