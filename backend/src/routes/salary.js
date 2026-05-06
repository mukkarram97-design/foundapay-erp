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
      SELECT sd.*, COUNT(si.id) AS items_count
        FROM salary_disbursements sd
        LEFT JOIN salary_items si ON si.disbursement_id = sd.id
       GROUP BY sd.id ORDER BY sd.pay_date DESC NULLS LAST, sd.created_at DESC
    `);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const sd = await pool.query('SELECT * FROM salary_disbursements WHERE id = $1', [req.params.id]);
    if (!sd.rows.length) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query(
      'SELECT * FROM salary_items WHERE disbursement_id = $1 ORDER BY full_name',
      [req.params.id]
    );
    res.json({ disbursement: sd.rows[0], items: items.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    if (!b.period) return res.status(400).json({ error: 'period required' });
    await c.query('BEGIN');
    const sd = await c.query(`
      INSERT INTO salary_disbursements
        (period, pay_date, exchange_rate, total_usd, total_pkr, status, notes)
      VALUES ($1,$2,COALESCE($3::numeric,280),COALESCE($4::numeric,0),COALESCE($5::numeric,0),COALESCE($6,'draft'),$7)
      RETURNING *
    `, [b.period, b.pay_date || null, b.exchange_rate, b.total_usd, b.total_pkr, b.status, b.notes || null]);
    if (Array.isArray(b.items)) {
      let totalUsd = 0, totalPkr = 0;
      for (const it of b.items) {
        await c.query(`
          INSERT INTO salary_items
            (disbursement_id, employee_name, full_name, bank_name, account_number, amount_usd, amount_pkr, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
        `, [sd.rows[0].id, it.name || it.employee_name, it.full || it.full_name, it.bank, it.account, it.usd, it.pkr]);
        totalUsd += parseFloat(it.usd) || 0;
        totalPkr += parseFloat(it.pkr) || 0;
      }
      await c.query(
        `UPDATE salary_disbursements SET total_usd = $1, total_pkr = $2 WHERE id = $3`,
        [totalUsd, totalPkr, sd.rows[0].id]
      );
    }
    await c.query('COMMIT');
    res.status(201).json(sd.rows[0]);
  } catch (err) {
    await c.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

router.patch('/:id/approve', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE salary_disbursements SET status = 'approved', approved_by = $1 WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/mark-disbursed', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE salary_disbursements SET status = 'disbursed' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/items/:itemId/paid', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE salary_items SET status = 'paid', paid_at = NOW() WHERE id = $1 AND disbursement_id = $2 RETURNING *`,
      [req.params.itemId, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ PATCH /api/salary/:id — update disbursement (FX rate triggers PKR recalc) ━━━
router.patch('/:id', async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    const fields = ['period', 'pay_date', 'exchange_rate', 'notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);

    await c.query('BEGIN');
    const r = await c.query(
      `UPDATE salary_disbursements SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    // If FX rate changed, recompute every item's amount_pkr = amount_usd * rate
    if (b.exchange_rate !== undefined) {
      const rate = parseFloat(b.exchange_rate) || 0;
      await c.query(
        `UPDATE salary_items SET amount_pkr = amount_usd * $1 WHERE disbursement_id = $2`,
        [rate, req.params.id]
      );
      const tot = await c.query(
        `SELECT COALESCE(SUM(amount_usd),0)::numeric(15,2) AS tu, COALESCE(SUM(amount_pkr),0)::numeric(15,2) AS tp
           FROM salary_items WHERE disbursement_id = $1`,
        [req.params.id]
      );
      await c.query(
        `UPDATE salary_disbursements SET total_usd = $1, total_pkr = $2 WHERE id = $3`,
        [tot.rows[0].tu, tot.rows[0].tp, req.params.id]
      );
    }

    await c.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ POST /api/salary/:id/items — add new employee ━━━
router.post('/:id/items', async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    if (!b.employee_name) return res.status(400).json({ error: 'employee_name required' });

    const sd = await c.query('SELECT exchange_rate FROM salary_disbursements WHERE id = $1', [req.params.id]);
    if (!sd.rows.length) return res.status(404).json({ error: 'Disbursement not found' });
    const rate = parseFloat(sd.rows[0].exchange_rate) || 280;
    const usd = parseFloat(b.amount_usd) || 0;
    const pkr = b.amount_pkr != null ? parseFloat(b.amount_pkr) : +(usd * rate).toFixed(2);

    await c.query('BEGIN');
    const r = await c.query(`
      INSERT INTO salary_items
        (disbursement_id, employee_name, full_name, bank_name, account_number,
         amount_usd, amount_pkr, status, is_active, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'pending'),COALESCE($9,true),$10)
      RETURNING *
    `, [req.params.id, b.employee_name, b.full_name || null, b.bank_name || null,
        b.account_number || null, usd, pkr, b.status, b.is_active, b.notes || null]);

    // Update disbursement totals
    const tot = await c.query(
      `SELECT COALESCE(SUM(amount_usd),0)::numeric(15,2) AS tu, COALESCE(SUM(amount_pkr),0)::numeric(15,2) AS tp
         FROM salary_items WHERE disbursement_id = $1`,
      [req.params.id]
    );
    await c.query(
      `UPDATE salary_disbursements SET total_usd = $1, total_pkr = $2 WHERE id = $3`,
      [tot.rows[0].tu, tot.rows[0].tp, req.params.id]
    );
    await c.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ PATCH /api/salary/:id/items/:itemId — edit employee ━━━
router.patch('/:id/items/:itemId', async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    const fields = ['employee_name', 'full_name', 'bank_name', 'account_number',
      'amount_usd', 'amount_pkr', 'status', 'is_active', 'notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    // If amount_usd changed but amount_pkr not provided, recalc using disbursement rate
    if (b.amount_usd !== undefined && b.amount_pkr === undefined) {
      const sd = await c.query('SELECT exchange_rate FROM salary_disbursements WHERE id = $1', [req.params.id]);
      const rate = parseFloat(sd.rows[0]?.exchange_rate) || 280;
      params.push(+((parseFloat(b.amount_usd) || 0) * rate).toFixed(2));
      sets.push(`amount_pkr = $${params.length}`);
    }

    params.push(req.params.itemId, req.params.id);
    await c.query('BEGIN');
    const r = await c.query(
      `UPDATE salary_items SET ${sets.join(', ')}
         WHERE id = $${params.length - 1} AND disbursement_id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    const tot = await c.query(
      `SELECT COALESCE(SUM(amount_usd),0)::numeric(15,2) AS tu, COALESCE(SUM(amount_pkr),0)::numeric(15,2) AS tp
         FROM salary_items WHERE disbursement_id = $1`,
      [req.params.id]
    );
    await c.query(
      `UPDATE salary_disbursements SET total_usd = $1, total_pkr = $2 WHERE id = $3`,
      [tot.rows[0].tu, tot.rows[0].tp, req.params.id]
    );
    await c.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ DELETE /api/salary/:id/items/:itemId — remove from payroll ━━━
router.delete('/:id/items/:itemId', async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(
      `DELETE FROM salary_items WHERE id = $1 AND disbursement_id = $2 RETURNING *`,
      [req.params.itemId, req.params.id]
    );
    if (!r.rows.length) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    const tot = await c.query(
      `SELECT COALESCE(SUM(amount_usd),0)::numeric(15,2) AS tu, COALESCE(SUM(amount_pkr),0)::numeric(15,2) AS tp
         FROM salary_items WHERE disbursement_id = $1`,
      [req.params.id]
    );
    await c.query(
      `UPDATE salary_disbursements SET total_usd = $1, total_pkr = $2 WHERE id = $3`,
      [tot.rows[0].tu, tot.rows[0].tp, req.params.id]
    );
    await c.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ PATCH /api/salary/:id/mark-all-paid — flip every pending item to paid ━━━
router.patch('/:id/mark-all-paid', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE salary_items SET status = 'paid', paid_at = NOW()
         WHERE disbursement_id = $1 AND status != 'paid' RETURNING id`,
      [req.params.id]
    );
    res.json({ ok: true, marked: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
