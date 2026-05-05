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

module.exports = router;
