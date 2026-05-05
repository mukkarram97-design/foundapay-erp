const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

// Hardcoded Q1 truths (from reconciled spreadsheets — they're not in the transactions table yet)
const Q1_2026 = {
  jan: { gross: 199935, revenue: 33960 },
  feb: { gross: 281305, revenue: 38983 },
  mar: { gross: 247784, revenue: 42620 },
  total_gross: 729024.81,
  total_revenue: 115563.01,
  net_profit: 49605.97,
  chargebacks: 13,
  cb_breakdown: { jan: 4, feb: 3, mar: 6 },
};

// ── GET /api/reports/q1-2026 ─────────────────────────────────
router.get('/q1-2026', async (req, res) => {
  // From DB if available; otherwise return reconciled totals
  const dbQ1 = await pool.query(`
    SELECT
      COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Received'), 0) AS gross,
      COALESCE(SUM(fee_amount)   FILTER (WHERE type = 'Received'), 0) AS revenue,
      COUNT(*) AS tx_count
    FROM transactions WHERE date_received BETWEEN '2026-01-01' AND '2026-03-31'
  `);
  res.json({
    reconciled: Q1_2026,
    db: dbQ1.rows[0],
  });
});

// ── GET /api/reports/april-2026 ──────────────────────────────
router.get('/april-2026', async (req, res) => {
  const r = await pool.query(`
    SELECT
      COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Received'), 0) AS gross,
      COALESCE(SUM(fee_amount)   FILTER (WHERE type = 'Received'), 0) AS revenue,
      COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Paid'),     0) AS paid_out,
      COUNT(*) AS tx_count
    FROM transactions WHERE date_received BETWEEN '2026-04-01' AND '2026-04-30'
  `);
  res.json({
    reconciled: { gross: 285497.51, revenue: 36835.62, paid_out: 184331.54, tx_count: 436 },
    db: r.rows[0],
  });
});

// ── GET /api/reports/pnl?from=&to=&entity_id= ────────────────
router.get('/pnl', async (req, res) => {
  try {
    const { from, to, entity_id } = req.query;
    const where = ['1=1']; const params = [];
    if (from)      { params.push(from);      where.push(`t.date_received >= $${params.length}`); }
    if (to)        { params.push(to);        where.push(`t.date_received <= $${params.length}`); }
    if (entity_id) { params.push(entity_id); where.push(`t.entity_id = $${params.length}`); }

    const txs = await pool.query(`
      SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Received'), 0) AS gross_received,
        COALESCE(SUM(fee_amount)   FILTER (WHERE type = 'Received'), 0) AS commission_revenue,
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Paid'), 0)     AS paid_out,
        COALESCE(SUM(merchant_charges) FILTER (WHERE type = 'Received' AND bearing_merchant_charges = 'FoundaPay'), 0) AS merchant_costs_borne,
        COALESCE(SUM(processor_fee_amount) FILTER (WHERE type = 'Received' AND processor_fee_bearer = 'FoundaPay'), 0) AS processor_costs_borne
      FROM transactions t WHERE ${where.join(' AND ')}
    `, params);

    const ex = await pool.query(`
      SELECT category, COALESCE(SUM(amount), 0) AS total
        FROM expenses
       WHERE 1=1 ${from ? `AND date >= '${from}'` : ''} ${to ? `AND date <= '${to}'` : ''}
       GROUP BY category
       ORDER BY total DESC
    `);

    const byEntity = await pool.query(`
      SELECT e.legal_name AS entity, COALESCE(SUM(t.fee_amount) FILTER (WHERE t.type = 'Received'), 0) AS revenue
        FROM entities e LEFT JOIN transactions t ON t.entity_id = e.id
        WHERE ${where.map(w => w.replace(/t\./g, 't.')).join(' AND ')}
        GROUP BY e.id ORDER BY revenue DESC
    `, params);

    const txsRow = txs.rows[0];
    const totalExpenses = ex.rows.reduce((s, r) => s + parseFloat(r.total), 0);
    const grossProfit = parseFloat(txsRow.commission_revenue) - parseFloat(txsRow.merchant_costs_borne) - parseFloat(txsRow.processor_costs_borne);
    const netProfit = grossProfit - totalExpenses;

    res.json({
      period: { from, to, entity_id },
      revenue: txsRow,
      expenses_by_category: ex.rows,
      revenue_by_entity: byEntity.rows,
      totals: {
        commission_revenue: txsRow.commission_revenue,
        gross_profit: grossProfit.toFixed(2),
        total_expenses: totalExpenses.toFixed(2),
        net_profit: netProfit.toFixed(2),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/balance-sheet ───────────────────────────
router.get('/balance-sheet', async (req, res) => {
  try {
    const banks = await pool.query(`
      SELECT e.legal_name AS entity, b.bank_name, b.current_balance
        FROM bank_accounts b LEFT JOIN entities e ON e.id = b.entity_id
        ORDER BY b.current_balance DESC
    `);
    const reserves = await pool.query(`
      SELECT COALESCE(SUM(amount - released_amount), 0) AS held FROM reserves WHERE status IN ('held','partially_released')
    `);
    const balances = await pool.query(`
      SELECT name, balance_owed FROM clients WHERE balance_owed != 0 ORDER BY balance_owed DESC
    `);

    const totalCash = banks.rows.reduce((s, r) => s + parseFloat(r.current_balance || 0), 0);
    const reservesHeld = parseFloat(reserves.rows[0].held);
    const owedToClients = balances.rows.reduce((s, r) => s + Math.max(0, parseFloat(r.balance_owed)), 0);
    const owedFromClients = balances.rows.reduce((s, r) => s + Math.max(0, -parseFloat(r.balance_owed)), 0);

    res.json({
      assets: {
        cash_in_banks: totalCash.toFixed(2),
        receivable_from_clients: owedFromClients.toFixed(2),
        reserve_funds_held: reservesHeld.toFixed(2),
        total_assets: (totalCash + owedFromClients + reservesHeld).toFixed(2),
      },
      liabilities: {
        payable_to_clients: owedToClients.toFixed(2),
        total_liabilities: owedToClients.toFixed(2),
      },
      bank_accounts: banks.rows,
      client_balances: balances.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/client-statement?client_id=&from=&to= ───
router.get('/client-statement', async (req, res) => {
  try {
    const { client_id, from, to } = req.query;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    const params = [client_id];
    let dateFilter = '';
    if (from) { params.push(from); dateFilter += ` AND date_received >= $${params.length}`; }
    if (to)   { params.push(to);   dateFilter += ` AND date_received <= $${params.length}`; }
    const cl = await pool.query('SELECT * FROM clients WHERE id = $1', [client_id]);
    if (!cl.rows.length) return res.status(404).json({ error: 'Client not found' });
    const txs = await pool.query(`
      SELECT t.*, m.processor_name FROM transactions t LEFT JOIN merchants m ON m.id = t.merchant_id
      WHERE t.client_id = $1 ${dateFilter} ORDER BY t.date_received DESC, t.id DESC
    `, params);
    const totals = await pool.query(`
      SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Received'), 0) AS gross_received,
        COALESCE(SUM(fee_amount)   FILTER (WHERE type = 'Received'), 0) AS commission,
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Paid'),     0) AS paid_out,
        COALESCE(SUM(reserve_amount), 0)                                AS reserve_held
      FROM transactions WHERE client_id = $1 ${dateFilter}
    `, params);
    res.json({ client: cl.rows[0], transactions: txs.rows, totals: totals.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/entity-breakdown ────────────────────────
router.get('/entity-breakdown', async (req, res) => {
  const { from, to } = req.query;
  const params = [];
  let where = '';
  if (from) { params.push(from); where += ` AND t.date_received >= $${params.length}`; }
  if (to)   { params.push(to);   where += ` AND t.date_received <= $${params.length}`; }
  const r = await pool.query(`
    SELECT e.legal_name AS entity, e.partner_name,
           COALESCE(SUM(t.gross_amount) FILTER (WHERE t.type = 'Received'), 0) AS gross,
           COALESCE(SUM(t.fee_amount) FILTER (WHERE t.type = 'Received'), 0) AS revenue,
           COUNT(t.id) AS tx_count
      FROM entities e LEFT JOIN transactions t ON t.entity_id = e.id ${where ? 'AND 1=1 ' + where : ''}
      GROUP BY e.id ORDER BY gross DESC
  `, params);
  res.json({ rows: r.rows });
});

module.exports = router;
