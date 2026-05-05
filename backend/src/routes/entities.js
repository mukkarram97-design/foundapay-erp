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
      SELECT e.*,
             COALESCE(SUM(t.gross_amount) FILTER (
               WHERE t.type = 'Received' AND date_trunc('month', t.date_received) = date_trunc('month', CURRENT_DATE)
             ), 0) AS mtd_volume,
             COUNT(t.id) AS tx_count,
             (SELECT json_agg(json_build_object('bank', b.bank_name, 'last4', b.account_last4, 'balance', b.current_balance))
                FROM bank_accounts b WHERE b.entity_id = e.id) AS banks
        FROM entities e
        LEFT JOIN transactions t ON t.entity_id = e.id
       GROUP BY e.id
       ORDER BY e.legal_name
    `);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const e = await pool.query('SELECT * FROM entities WHERE id = $1', [req.params.id]);
    if (!e.rows.length) return res.status(404).json({ error: 'Not found' });
    const banks = await pool.query('SELECT * FROM bank_accounts WHERE entity_id = $1', [req.params.id]);
    const cards = await pool.query('SELECT * FROM cards WHERE entity_id = $1', [req.params.id]);
    res.json({ entity: e.rows[0], banks: banks.rows, cards: cards.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.legal_name) return res.status(400).json({ error: 'legal_name required' });
    const r = await pool.query(`
      INSERT INTO entities
        (legal_name, dba_name, entity_type, owner_name, owner_email, phone, address,
         ein_reference, website, partner_name, status, monthly_processing_limit)
      VALUES ($1,$2,COALESCE($3,'LLC'),$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'active'),$12)
      RETURNING *
    `, [
      b.legal_name, b.dba_name || null, b.entity_type, b.owner_name || null, b.owner_email || null,
      b.phone || null, b.address || null,
      b.ein_reference || `EIN_DOC_REF_${b.legal_name.replace(/\s+/g, '_')}`,
      b.website || null, b.partner_name || b.owner_name || null, b.status,
      b.monthly_processing_limit || null,
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['legal_name','dba_name','entity_type','owner_name','owner_email','phone','address',
      'ein_reference','website','partner_name','status','risk_status','monthly_processing_limit'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE entities SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
