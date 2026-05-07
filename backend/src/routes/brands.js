// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Per-client brands — CRUD endpoints used by the Virtual Terminal
// brand selector and (later) the Clients page brand-management UI.
//
// Mounted at /api/clients/:client_id/brands and /api/brands/:id.
// Only super_admin / owner / admin / finance_manager can mutate.
// client_user can read brands for their own client only.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
router.use(authRequired);

const STAFF = new Set(['super_admin', 'owner', 'admin', 'finance_manager']);
const isStaff = (req) => STAFF.has(req.user?.role);

// Ensure the requester can see the given client_id (staff: any; client_user: own).
function canRead(req, clientId) {
  if (isStaff(req)) return true;
  return req.user.role === 'client_user' && req.user.client_id === clientId;
}

// GET /api/clients/:client_id/brands
router.get('/', async (req, res) => {
  try {
    const cid = req.params.client_id;
    if (!cid) return res.status(400).json({ error: 'client_id required' });
    if (!canRead(req, cid)) return res.status(403).json({ error: 'forbidden' });
    const r = await pool.query(`
      SELECT id, client_id, name, statement_descriptor, descriptor_note,
             logo_url, brand_color, support_email, support_phone,
             is_default, is_archived, created_at, updated_at
        FROM client_brands
       WHERE client_id = $1 AND is_archived = false
       ORDER BY is_default DESC, name ASC
    `, [cid]);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/clients/:client_id/brands
router.post('/', async (req, res) => {
  if (!isStaff(req)) return res.status(403).json({ error: 'forbidden' });
  const c = await pool.connect();
  try {
    const cid = req.params.client_id;
    const b = req.body || {};
    if (!cid || !b.name) return res.status(400).json({ error: 'client_id + name required' });

    await c.query('BEGIN');
    // If this brand will be the default, unset any existing default first.
    if (b.is_default) {
      await c.query(`UPDATE client_brands SET is_default = false
                      WHERE client_id = $1 AND is_default = true`, [cid]);
    }
    const r = await c.query(`
      INSERT INTO client_brands
        (client_id, name, statement_descriptor, descriptor_note,
         logo_url, brand_color, support_email, support_phone,
         is_default, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      cid,
      String(b.name).slice(0, 120),
      b.statement_descriptor ? String(b.statement_descriptor).slice(0, 22) : null,
      b.descriptor_note || null,
      b.logo_url || null,
      b.brand_color || null,
      b.support_email || null,
      b.support_phone || null,
      !!b.is_default,
      req.user.id,
    ]);
    await c.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    c.release();
  }
});

// PUT /api/clients/:client_id/brands/:id
router.put('/:id', async (req, res) => {
  if (!isStaff(req)) return res.status(403).json({ error: 'forbidden' });
  const c = await pool.connect();
  try {
    const cid = req.params.client_id;
    const id  = req.params.id;
    const b = req.body || {};
    await c.query('BEGIN');
    if (b.is_default) {
      await c.query(`UPDATE client_brands SET is_default = false
                      WHERE client_id = $1 AND is_default = true AND id <> $2`, [cid, id]);
    }
    const fields = [];
    const params = [];
    const set = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };
    if (b.name              !== undefined) set('name',                 String(b.name).slice(0, 120));
    if (b.statement_descriptor !== undefined) set('statement_descriptor', b.statement_descriptor ? String(b.statement_descriptor).slice(0, 22) : null);
    if (b.descriptor_note   !== undefined) set('descriptor_note',      b.descriptor_note || null);
    if (b.logo_url          !== undefined) set('logo_url',             b.logo_url || null);
    if (b.brand_color       !== undefined) set('brand_color',          b.brand_color || null);
    if (b.support_email     !== undefined) set('support_email',        b.support_email || null);
    if (b.support_phone     !== undefined) set('support_phone',        b.support_phone || null);
    if (b.is_default        !== undefined) set('is_default',           !!b.is_default);
    if (b.is_archived       !== undefined) set('is_archived',          !!b.is_archived);
    if (fields.length === 0) {
      await c.query('ROLLBACK');
      return res.status(400).json({ error: 'no fields to update' });
    }
    fields.push(`updated_at = NOW()`);
    params.push(id, cid);
    const r = await c.query(`
      UPDATE client_brands SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND client_id = $${params.length}
       RETURNING *
    `, params);
    await c.query('COMMIT');
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    c.release();
  }
});

// DELETE /api/clients/:client_id/brands/:id  → soft-delete (is_archived = true)
router.delete('/:id', async (req, res) => {
  if (!isStaff(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const cid = req.params.client_id;
    const id  = req.params.id;
    const r = await pool.query(`
      UPDATE client_brands
         SET is_archived = true, is_default = false, updated_at = NOW()
       WHERE id = $1 AND client_id = $2
       RETURNING id
    `, [id, cid]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
