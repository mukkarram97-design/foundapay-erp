const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

const STAGES = ['prepared','finance_review','admin_approval','approved','sent','proof_uploaded','closed'];

router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.*, c.name AS client_name FROM payouts p
        LEFT JOIN clients c ON c.id = p.client_id
       ORDER BY p.created_at DESC
    `);
    res.json({ rows: r.rows, stages: STAGES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.client_id || !b.amount) return res.status(400).json({ error: 'client_id and amount required' });
    const r = await pool.query(`
      INSERT INTO payouts
        (client_id, amount, currency, country, recipient_name, payout_method,
         exchange_rate, transfer_fee, reference_number, status, prepared_by, notes)
      VALUES ($1,$2,COALESCE($3,'USD'),$4,$5,$6,$7,$8,$9,'prepared',$10,$11)
      RETURNING *
    `, [
      b.client_id, b.amount, b.currency, b.country || null, b.recipient_name || null,
      b.payout_method || null, b.exchange_rate || null, b.transfer_fee || null,
      b.reference_number || null, req.user.id, b.notes || null,
    ]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['amount','currency','country','recipient_name','payout_method','exchange_rate',
      'transfer_fee','reference_number','proof_url','notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(`UPDATE payouts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payouts/:id/advance ────────────────────────────
// Advance to next stage. Optionally accept ?to=approved for explicit jump.
router.post('/:id/advance', async (req, res) => {
  try {
    const cur = await pool.query('SELECT * FROM payouts WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
    const p = cur.rows[0];
    const idx = STAGES.indexOf(p.status);
    let nextStage = req.body?.to || (idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null);
    if (!nextStage) return res.status(400).json({ error: 'Already at final stage' });
    if (!STAGES.includes(nextStage)) return res.status(400).json({ error: 'Invalid stage' });

    const stamps = {};
    if (nextStage === 'finance_review') stamps.finance_reviewed_by = req.user.id;
    if (nextStage === 'approved')        { stamps.approved_by = req.user.id; stamps.approved_at = new Date(); }
    if (nextStage === 'sent')            { stamps.sent_by = req.user.id; stamps.sent_at = new Date(); }
    if (nextStage === 'closed')          stamps.closed_at = new Date();

    const setKeys = ['status', ...Object.keys(stamps)];
    const setVals = [nextStage, ...Object.values(stamps)];
    const params = [...setVals, req.params.id];
    const sets = setKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const r = await pool.query(
      `UPDATE payouts SET ${sets} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE payouts SET status = 'rejected', notes = COALESCE(notes, '') || E'\nRejected: ' || COALESCE($1, '')
        WHERE id = $2 RETURNING *`,
      [req.body?.reason || '', req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
