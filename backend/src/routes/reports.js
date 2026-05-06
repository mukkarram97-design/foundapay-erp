const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { buildRevenueSummary, buildPayoutReconciliation, buildTaxSummary } = require('../services/pdfReports');
const { buildStatement } = require('../services/pdfReceipt');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

// CSV row escaper used by all CSV exports.
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvLine(values) { return values.map(csvCell).join(',') + '\n'; }

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// New report endpoints (revenue-summary, payout-reconciliation,
// tax-summary, transaction-export). All accept ?format=pdf or
// ?format=csv to download. Defaults to JSON for in-page preview.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━ GET /api/reports/revenue-summary ━━━
router.get('/revenue-summary', async (req, res) => {
  try {
    const { from, to, group_by = 'month', format } = req.query;
    const groupBy = ['day', 'week', 'month'].includes(group_by) ? group_by : 'month';
    const where = ['t.is_deleted = false'];
    const params = [];
    if (from) { params.push(from); where.push(`t.date_received >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`t.date_received <= $${params.length}`); }

    const totalsR = await pool.query(`
      SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE type='Received'), 0)::float AS gross,
        COALESCE(SUM(fee_amount)   FILTER (WHERE type='Received'), 0)::float AS revenue,
        COALESCE(SUM(net_amount)   FILTER (WHERE type='Received'), 0)::float AS net,
        COUNT(*) FILTER (WHERE type='Received')::int AS tx_count
      FROM transactions t WHERE ${where.join(' AND ')}
    `, params);

    const periodFmt = ({ day: 'YYYY-MM-DD', week: 'IYYY-IW', month: 'YYYY-MM' })[groupBy];
    const byPeriodR = await pool.query(`
      SELECT to_char(date_received, $${params.length + 1}) AS period,
             COALESCE(SUM(gross_amount) FILTER (WHERE type='Received'), 0)::float AS gross,
             COALESCE(SUM(fee_amount)   FILTER (WHERE type='Received'), 0)::float AS revenue,
             COALESCE(SUM(net_amount)   FILTER (WHERE type='Received'), 0)::float AS net,
             COUNT(*) FILTER (WHERE type='Received')::int AS tx_count
        FROM transactions t WHERE ${where.join(' AND ')}
        GROUP BY 1 ORDER BY 1 DESC
    `, [...params, periodFmt]);

    const byClientR = await pool.query(`
      SELECT c.name AS client_name,
             COALESCE(SUM(t.gross_amount) FILTER (WHERE t.type='Received'), 0)::float AS gross,
             COALESCE(SUM(t.fee_amount)   FILTER (WHERE t.type='Received'), 0)::float AS revenue,
             COUNT(*) FILTER (WHERE t.type='Received')::int AS tx_count
        FROM transactions t LEFT JOIN clients c ON c.id = t.client_id
       WHERE ${where.join(' AND ')}
       GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT 50
    `, params);

    const byMethodR = await pool.query(`
      SELECT t.payment_method,
             COALESCE(SUM(t.gross_amount) FILTER (WHERE t.type='Received'), 0)::float AS gross,
             COALESCE(SUM(t.fee_amount)   FILTER (WHERE t.type='Received'), 0)::float AS revenue,
             COUNT(*) FILTER (WHERE t.type='Received')::int AS tx_count
        FROM transactions t WHERE ${where.join(' AND ')}
       GROUP BY t.payment_method ORDER BY gross DESC
    `, params);

    const data = {
      period: { from, to, group_by: groupBy },
      totals: totalsR.rows[0],
      byPeriod: byPeriodR.rows,
      byClient: byClientR.rows,
      byMethod: byMethodR.rows,
    };

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="revenue-summary-${from || 'all'}-to-${to || 'all'}.pdf"`);
      return buildRevenueSummary({ from, to, groupBy, ...data }, res);
    }
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="revenue-summary-${from || 'all'}-to-${to || 'all'}.csv"`);
      res.write(csvLine(['period', 'gross', 'revenue', 'net', 'tx_count']));
      for (const r of byPeriodR.rows) res.write(csvLine([r.period, r.gross, r.revenue, r.net, r.tx_count]));
      return res.end();
    }
    res.json(data);
  } catch (err) {
    console.error('[reports revenue-summary]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /api/reports/payout-reconciliation ━━━
router.get('/payout-reconciliation', async (req, res) => {
  try {
    const { from, to, client_id, format } = req.query;
    const txWhere = ['t.is_deleted = false'];
    const txParams = [];
    if (from)     { txParams.push(from);     txWhere.push(`t.date_received >= $${txParams.length}`); }
    if (to)       { txParams.push(to);       txWhere.push(`t.date_received <= $${txParams.length}`); }
    if (client_id){ txParams.push(client_id); txWhere.push(`t.client_id = $${txParams.length}`); }

    const totals = await pool.query(`
      SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE type='Received'),0)::float AS received,
        COALESCE(SUM(net_amount)   FILTER (WHERE type='Received'),0)::float AS net_to_client,
        COALESCE(SUM(reserve_amount),0)::float AS reserve_held
      FROM transactions t WHERE ${txWhere.join(' AND ')}
    `, txParams);

    const poWhere = ['1=1']; const poParams = [];
    if (from)     { poParams.push(from);     poWhere.push(`p.created_at >= $${poParams.length}`); }
    if (to)       { poParams.push(to);       poWhere.push(`p.created_at <= $${poParams.length}::timestamptz + INTERVAL '1 day'`); }
    if (client_id){ poParams.push(client_id); poWhere.push(`p.client_id = $${poParams.length}`); }
    const payouts = await pool.query(`
      SELECT p.id, p.created_at, p.amount, p.currency, p.payout_method, p.reference_number, p.status
        FROM payouts p WHERE ${poWhere.join(' AND ')}
       ORDER BY p.created_at DESC LIMIT 1000
    `, poParams);
    const paidOut = payouts.rows.reduce((s, p) => s + (p.status === 'sent' ? parseFloat(p.amount) : 0), 0);
    const totalsOut = {
      received: parseFloat(totals.rows[0].received) || 0,
      paid_out: paidOut,
      reserve_held: parseFloat(totals.rows[0].reserve_held) || 0,
      pending: Math.max(0, (parseFloat(totals.rows[0].net_to_client) || 0) - paidOut - (parseFloat(totals.rows[0].reserve_held) || 0)),
    };

    let client = null;
    if (client_id) {
      const c = await pool.query('SELECT id, name FROM clients WHERE id = $1', [client_id]);
      client = c.rows[0] || null;
    }

    const data = { period: { from, to }, client, totals: totalsOut, payouts: payouts.rows };

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="payout-recon-${from || 'all'}-to-${to || 'all'}.pdf"`);
      return buildPayoutReconciliation({ from, to, client, totals: totalsOut, payouts: payouts.rows }, res);
    }
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="payout-recon-${from || 'all'}-to-${to || 'all'}.csv"`);
      res.write(csvLine(['date', 'amount', 'currency', 'method', 'reference', 'status']));
      for (const p of payouts.rows) res.write(csvLine([p.created_at, p.amount, p.currency, p.payout_method, p.reference_number, p.status]));
      return res.end();
    }
    res.json(data);
  } catch (err) {
    console.error('[reports payout-recon]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /api/reports/tax-summary ━━━
router.get('/tax-summary', async (req, res) => {
  try {
    const { from, to, format } = req.query;
    const where = ['t.is_deleted = false'];
    const params = [];
    if (from) { params.push(from); where.push(`t.date_received >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`t.date_received <= $${params.length}`); }

    const r = await pool.query(`
      SELECT
        COALESCE(SUM(fee_amount)   FILTER (WHERE type='Received'), 0)::float AS commission_revenue,
        COALESCE(SUM(merchant_charges) FILTER (WHERE bearing_merchant_charges='FoundaPay'), 0)::float AS fees_borne
      FROM transactions t WHERE ${where.join(' AND ')}
    `, params);

    const exWhere = ['1=1']; const exParams = [];
    if (from) { exParams.push(from); exWhere.push(`date >= $${exParams.length}`); }
    if (to)   { exParams.push(to);   exWhere.push(`date <= $${exParams.length}`); }
    const ex = await pool.query(`
      SELECT category, COALESCE(SUM(amount), 0)::float AS total
        FROM expenses WHERE ${exWhere.join(' AND ')}
       GROUP BY category ORDER BY total DESC
    `, exParams);
    const totalEx = ex.rows.reduce((s, e) => s + parseFloat(e.total), 0);
    const grossIncome = parseFloat(r.rows[0].commission_revenue) || 0;
    const feesBorne = parseFloat(r.rows[0].fees_borne) || 0;
    const totals = {
      gross_income: grossIncome,
      deductible_expenses: totalEx,
      fees_borne: feesBorne,
      net_taxable: grossIncome - totalEx - feesBorne,
    };

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="tax-summary-${from || 'all'}-to-${to || 'all'}.pdf"`);
      return buildTaxSummary({ from, to, totals, expensesByCat: ex.rows }, res);
    }
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tax-summary-${from || 'all'}-to-${to || 'all'}.csv"`);
      res.write(csvLine(['line', 'amount']));
      res.write(csvLine(['Gross income', totals.gross_income]));
      res.write(csvLine(['Deductible expenses', -totals.deductible_expenses]));
      res.write(csvLine(['Fees borne', -totals.fees_borne]));
      res.write(csvLine(['Net taxable', totals.net_taxable]));
      return res.end();
    }
    res.json({ period: { from, to }, totals, expenses_by_category: ex.rows });
  } catch (err) {
    console.error('[reports tax-summary]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /api/reports/transaction-export.csv ━━━
// Full CSV of filtered transactions. Same filter shape as Master Ledger.
router.get('/transaction-export', async (req, res) => {
  try {
    const where = ['t.is_deleted = false'];
    const params = [];
    const q = req.query;
    if (q.from)        { params.push(q.from);        where.push(`t.date_received >= $${params.length}`); }
    if (q.to)          { params.push(q.to);          where.push(`t.date_received <= $${params.length}`); }
    if (q.client_id)   { params.push(q.client_id);   where.push(`t.client_id = $${params.length}`); }
    if (q.entity_id)   { params.push(q.entity_id);   where.push(`t.entity_id = $${params.length}`); }
    if (q.merchant_id) { params.push(q.merchant_id); where.push(`t.merchant_id = $${params.length}`); }
    if (q.status)      { params.push(q.status);      where.push(`t.status = $${params.length}`); }
    if (q.type)        { params.push(q.type);        where.push(`t.type = $${params.length}`); }
    if (q.payment_method){ params.push(q.payment_method); where.push(`t.payment_method = $${params.length}`); }
    if (q.source)      { params.push(q.source);      where.push(`t.source = $${params.length}`); }
    if (q.q) {
      params.push(`%${q.q}%`);
      const i = params.length;
      where.push(`(t.counterparty_name ILIKE $${i} OR t.customer_name ILIKE $${i} OR t.customer_email ILIKE $${i} OR t.external_txn_id ILIKE $${i})`);
    }

    const r = await pool.query(`
      SELECT t.id, t.date_received, t.type, t.status, t.payment_method, t.source,
             c.name AS client_name, e.legal_name AS entity_name,
             t.counterparty_name, t.customer_name, t.customer_email,
             t.gross_amount, t.foundapay_fee_pct, t.fee_amount, t.net_amount,
             t.merchant_charges, t.reserve_amount,
             t.external_txn_id, t.processor_reference, t.card_last4, t.card_brand,
             t.notes
        FROM transactions t
        LEFT JOIN clients c  ON c.id = t.client_id
        LEFT JOIN entities e ON e.id = t.entity_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.date_received DESC, t.id DESC
       LIMIT 10000
    `, params);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${q.from || 'all'}-to-${q.to || 'all'}.csv"`);
    res.write(csvLine(['id','date','type','status','method','source','client','entity','counterparty','customer_name','customer_email','gross','fee_pct','fee_amount','net','merchant_charges','reserve','external_txn_id','auth_code','last4','card_brand','notes']));
    for (const x of r.rows) {
      res.write(csvLine([
        x.id, x.date_received, x.type, x.status, x.payment_method, x.source,
        x.client_name, x.entity_name, x.counterparty_name, x.customer_name, x.customer_email,
        x.gross_amount, x.foundapay_fee_pct, x.fee_amount, x.net_amount,
        x.merchant_charges, x.reserve_amount,
        x.external_txn_id, x.processor_reference, x.card_last4, x.card_brand,
        x.notes,
      ]));
    }
    res.end();
  } catch (err) {
    console.error('[reports transaction-export]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /api/reports/client-statement (PDF/CSV variant of existing endpoint) ━━━
// The JSON shape is preserved above; this branch just adds format handling.
router.get('/client-statement.pdf', async (req, res) => {
  try {
    const { client_id, from, to } = req.query;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    const cl = await pool.query('SELECT * FROM clients WHERE id = $1', [client_id]);
    if (!cl.rows.length) return res.status(404).json({ error: 'Client not found' });
    const params = [client_id];
    let dateFilter = '';
    if (from) { params.push(from); dateFilter += ` AND date_received >= $${params.length}`; }
    if (to)   { params.push(to);   dateFilter += ` AND date_received <= $${params.length}`; }
    const txs = await pool.query(`
      SELECT * FROM transactions WHERE client_id = $1 AND is_deleted = false ${dateFilter}
       ORDER BY date_received DESC, id DESC
    `, params);
    const totals = await pool.query(`
      SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE type='Received'),0) AS gross_received,
        COALESCE(SUM(fee_amount)   FILTER (WHERE type='Received'),0) AS commission,
        COALESCE(SUM(gross_amount) FILTER (WHERE type='Paid'),0)     AS paid_out,
        COALESCE(SUM(reserve_amount),0)                              AS reserve_held
      FROM transactions WHERE client_id = $1 AND is_deleted = false ${dateFilter}
    `, params);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${cl.rows[0].name.replace(/\s+/g, '_')}-${from || 'all'}-to-${to || 'all'}.pdf"`);
    buildStatement({
      client: cl.rows[0],
      period: { from: from || '—', to: to || '—' },
      transactions: txs.rows,
      totals: totals.rows[0],
    }, res);
  } catch (err) {
    console.error('[reports statement.pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
