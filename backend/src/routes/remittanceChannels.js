// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// /api/remittance-channels — CRUD for non-Wise sender rails
// (bank wires, RIA, MoneyGram, hawala, etc.). Staff-only writes.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

const STAFF = new Set(['super_admin', 'owner', 'admin', 'finance_manager']);
const isStaff = (req) => STAFF.has(req.user?.role);

// GET /api/remittance-channels  — all rows; ?active=true to filter
router.get('/', async (req, res) => {
  try {
    const onlyActive = req.query.active === 'true';
    const r = await pool.query(`
      SELECT id, name, channel_type, account_reference, instructions, is_active,
             created_at, updated_at
        FROM remittance_channels
       ${onlyActive ? 'WHERE is_active = true' : ''}
       ORDER BY is_active DESC, name ASC
    `);
    res.json({ rows: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  if (!isStaff(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`
      INSERT INTO remittance_channels (name, channel_type, account_reference, instructions, is_active, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      String(b.name).slice(0, 255),
      String(b.channel_type || 'wire').slice(0, 50),
      b.account_reference || null,
      b.instructions || null,
      b.is_active !== false,
      req.user.id,
    ]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  if (!isStaff(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const b = req.body || {};
    const sets = [];
    const params = [];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (b.name              !== undefined) set('name',              String(b.name).slice(0, 255));
    if (b.channel_type      !== undefined) set('channel_type',      String(b.channel_type).slice(0, 50));
    if (b.account_reference !== undefined) set('account_reference', b.account_reference || null);
    if (b.instructions      !== undefined) set('instructions',      b.instructions || null);
    if (b.is_active         !== undefined) set('is_active',         !!b.is_active);
    if (sets.length === 0) return res.status(400).json({ error: 'no fields' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE remittance_channels SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  if (!isStaff(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const r = await pool.query(
      `DELETE FROM remittance_channels WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
