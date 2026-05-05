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
    const { card_id, entity_id, category, from, to } = req.query;
    const where = []; const params = [];
    if (card_id)   { params.push(card_id);   where.push(`e.card_id = $${params.length}`); }
    if (entity_id) { params.push(entity_id); where.push(`e.entity_id = $${params.length}`); }
    if (category)  { params.push(category);  where.push(`e.category = $${params.length}`); }
    if (from)      { params.push(from);      where.push(`e.date >= $${params.length}`); }
    if (to)        { params.push(to);        where.push(`e.date <= $${params.length}`); }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT e.*, c.nickname AS card_nickname, c.last4 AS card_last4, en.legal_name AS entity_name,
             cl.name AS client_name
        FROM expenses e
        LEFT JOIN cards c ON c.id = e.card_id
        LEFT JOIN entities en ON en.id = e.entity_id
        LEFT JOIN clients cl ON cl.id = e.client_id
        ${whereSQL}
        ORDER BY e.date DESC
    `, params);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/renewals', async (req, res) => {
  try {
    const days = parseInt(req.query.days || '30', 10);
    const r = await pool.query(`
      SELECT e.*, c.nickname AS card_nickname, c.last4 AS card_last4
        FROM expenses e
        LEFT JOIN cards c ON c.id = e.card_id
       WHERE e.is_recurring = true
         AND e.next_renewal_date IS NOT NULL
         AND e.next_renewal_date <= CURRENT_DATE + ($1 || ' days')::interval
       ORDER BY e.next_renewal_date
    `, [days]);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(`
      INSERT INTO expenses
        (date, card_id, entity_id, category, subcategory, vendor, description, amount, currency,
         payment_type, is_client_billable, client_id, is_recurring, recurrence_interval,
         next_renewal_date, receipt_url, status, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'USD'),COALESCE($10,'card'),
              COALESCE($11,false),$12,COALESCE($13,false),$14,$15,$16,COALESCE($17,'approved'),$18,$19)
      RETURNING *
    `, [
      b.date || new Date().toISOString().slice(0,10),
      b.card_id || null, b.entity_id || null, b.category || null, b.subcategory || null,
      b.vendor || null, b.description || null, b.amount, b.currency, b.payment_type,
      b.is_client_billable, b.client_id || null, b.is_recurring, b.recurrence_interval || null,
      b.next_renewal_date || null, b.receipt_url || null, b.status, b.notes || null, req.user.id,
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['date','card_id','entity_id','category','subcategory','vendor','description',
      'amount','currency','payment_type','is_client_billable','client_id','is_recurring',
      'recurrence_interval','next_renewal_date','receipt_url','status','notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(`UPDATE expenses SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM expenses WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: r.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
