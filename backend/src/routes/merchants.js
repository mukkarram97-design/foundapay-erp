const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { rankMerchants } = require('../services/routingEngine');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT m.*, e.legal_name AS entity_name, b.bank_name
        FROM merchants m
        LEFT JOIN entities e ON e.id = m.entity_id
        LEFT JOIN bank_accounts b ON b.id = m.bank_account_id
        ORDER BY m.processor_name, e.legal_name
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
      INSERT INTO merchants
        (processor_name, account_name, entity_id, bank_account_id, mid,
         processing_fee_pct, fixed_fee, reserve_pct, chargeback_fee, settlement_delay_days,
         daily_limit, monthly_limit, availability, risk_status, supported_methods, notes)
      VALUES ($1,$2,$3,$4,$5,COALESCE($6::numeric,0),COALESCE($7::numeric,0),COALESCE($8::numeric,0),COALESCE($9::numeric,0),COALESCE($10::int,2),
              $11,$12,COALESCE($13,'available'),COALESCE($14,'normal'),$15,$16)
      RETURNING *
    `, [
      b.processor_name, b.account_name || null, b.entity_id || null, b.bank_account_id || null, b.mid || null,
      b.processing_fee_pct, b.fixed_fee, b.reserve_pct, b.chargeback_fee, b.settlement_delay_days,
      b.daily_limit || null, b.monthly_limit || null, b.availability, b.risk_status,
      b.supported_methods || null, b.notes || null,
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['processor_name','account_name','entity_id','bank_account_id','mid',
      'processing_fee_pct','fixed_fee','reserve_pct','chargeback_fee','settlement_delay_days',
      'daily_limit','monthly_limit','availability','risk_status','chargeback_rate',
      'supported_methods','notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE merchants SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/merchants/route ───────────────────────────────
router.post('/route', async (req, res) => {
  try {
    const { amount, method } = req.body || {};
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const r = await pool.query(`
      SELECT m.*, e.legal_name AS entity_name FROM merchants m
        LEFT JOIN entities e ON e.id = m.entity_id
    `);
    const ranked = rankMerchants(r.rows, parseFloat(amount), method);
    res.json({ ranked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
