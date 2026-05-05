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
      SELECT c.*, e.legal_name AS entity_name,
             COALESCE(SUM(ex.amount) FILTER (
               WHERE date_trunc('month', ex.date) = date_trunc('month', CURRENT_DATE)
             ), 0) AS mtd_spend
        FROM cards c
        LEFT JOIN entities e ON e.id = c.entity_id
        LEFT JOIN expenses ex ON ex.card_id = c.id
       GROUP BY c.id, e.legal_name
       ORDER BY e.legal_name NULLS LAST, c.bank_name, c.last4
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
      INSERT INTO cards
        (nickname, last4, card_type, bank_name, network, entity_id, cardholder_name,
         monthly_limit, alert_threshold_pct, expiry, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,80),$10,COALESCE($11,'active'))
      RETURNING *
    `, [
      b.nickname || null, b.last4 || null, b.card_type || 'virtual', b.bank_name || null,
      b.network || null, b.entity_id || null, b.cardholder_name || null,
      b.monthly_limit || null, b.alert_threshold_pct, b.expiry || null, b.status,
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['nickname','last4','card_type','bank_name','network','entity_id','cardholder_name',
      'monthly_limit','alert_threshold_pct','expiry','status'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE cards SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cards/bulk-import ──────────────────────────────
router.post('/bulk-import', async (req, res) => {
  const c = await pool.connect();
  try {
    const rows = (req.body && req.body.rows) || [];
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows array required' });

    const entityByName = {};
    (await c.query('SELECT id, legal_name FROM entities')).rows
      .forEach(r => { entityByName[r.legal_name] = r.id; });

    await c.query('BEGIN');
    let inserted = 0, skipped = 0;
    for (const b of rows) {
      try {
        const entityId = b.entity_id || (b.entity_name ? entityByName[b.entity_name] : null) || null;
        await c.query(`
          INSERT INTO cards
            (nickname, last4, card_type, bank_name, entity_id, cardholder_name, expiry, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'active'))
        `, [
          b.nickname || null, b.last4 || null, b.card_type || 'virtual', b.bank_name || null,
          entityId, b.cardholder_name || null, b.expiry || null, b.status,
        ]);
        inserted++;
      } catch { skipped++; }
    }
    await c.query('COMMIT');
    res.json({ inserted, skipped });
  } catch (err) {
    await c.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

module.exports = router;
