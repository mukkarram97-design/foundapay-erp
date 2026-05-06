const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

// ── GET /api/dashboard/summary?period=mtd|today|q1_2026|april_2026|custom ──
router.get('/summary', async (req, res) => {
  try {
    const { period = 'mtd', from, to } = req.query;
    let dateFrom, dateTo;
    const fmt = (d) => d.toISOString().slice(0, 10);
    const now = new Date();
    if (period === 'today') {
      dateFrom = dateTo = fmt(now);
    } else if (period === 'last_7d' || period === '7d') {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      dateFrom = fmt(d); dateTo = fmt(now);
    } else if (period === 'last_30d' || period === '30d') {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      dateFrom = fmt(d); dateTo = fmt(now);
    } else if (period === 'mtd') {
      dateFrom = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
      dateTo = fmt(now);
    } else if (period === 'qtd') {
      const qStart = Math.floor(now.getMonth() / 3) * 3;
      dateFrom = fmt(new Date(now.getFullYear(), qStart, 1));
      dateTo = fmt(now);
    } else if (period === 'ytd') {
      dateFrom = fmt(new Date(now.getFullYear(), 0, 1));
      dateTo = fmt(now);
    } else if (period === 'q1_2026') {
      dateFrom = '2026-01-01'; dateTo = '2026-03-31';
    } else if (period === 'april_2026') {
      dateFrom = '2026-04-01'; dateTo = '2026-04-30';
    } else if (period === 'custom') {
      dateFrom = from; dateTo = to;
    }
    if (!dateFrom || !dateTo) {
      // sane fallback to MTD if anything went wrong
      dateFrom = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
      dateTo = fmt(now);
    }
    const params = [dateFrom, dateTo];

    const summary = await pool.query(`
      SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Received'), 0) AS gross_received,
        COALESCE(SUM(fee_amount)   FILTER (WHERE type = 'Received'), 0) AS revenue,
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Paid'),     0) AS paid_out,
        COALESCE(SUM(reserve_amount), 0)                                AS reserve_held,
        COUNT(*) FILTER (WHERE status = 'Hold')                         AS on_hold_count,
        COUNT(*) FILTER (WHERE status = 'Charge Back')                  AS chargeback_count,
        COUNT(*)                                                         AS tx_count
      FROM transactions
      WHERE is_deleted = false AND date_received BETWEEN $1 AND $2
    `, params);

    const today = await pool.query(`
      SELECT COUNT(*) AS today_count,
             COALESCE(SUM(gross_amount), 0) AS today_gross
        FROM transactions WHERE is_deleted = false AND date_received = CURRENT_DATE
    `);

    const dailyChart = await pool.query(`
      SELECT date_received::text AS date,
             COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Received'), 0) AS gross,
             COALESCE(SUM(fee_amount)   FILTER (WHERE type = 'Received'), 0) AS revenue
        FROM transactions
       WHERE is_deleted = false AND date_received >= $1 AND date_received <= $2
       GROUP BY date_received
       ORDER BY date_received
    `, params);

    const topEntities = await pool.query(`
      SELECT e.legal_name AS name,
             COALESCE(SUM(t.gross_amount) FILTER (WHERE t.type = 'Received'), 0) AS volume
        FROM entities e
        LEFT JOIN transactions t ON t.entity_id = e.id AND t.is_deleted = false AND t.date_received BETWEEN $1 AND $2
       GROUP BY e.id
       ORDER BY volume DESC
       LIMIT 8
    `, params);

    const methodMix = await pool.query(`
      SELECT COALESCE(payment_method, 'Other') AS method,
             COALESCE(SUM(gross_amount), 0) AS amount
        FROM transactions
       WHERE is_deleted = false AND date_received BETWEEN $1 AND $2 AND type = 'Received'
       GROUP BY payment_method
       ORDER BY amount DESC
    `, params);

    const topClients = await pool.query(`
      SELECT id, name, balance_owed FROM clients
       ORDER BY ABS(balance_owed) DESC
       LIMIT 12
    `);

    const cardAlerts = await pool.query(`
      SELECT c.id, c.nickname, c.last4, c.bank_name, c.monthly_limit,
             COALESCE(SUM(ex.amount) FILTER (
               WHERE date_trunc('month', ex.date) = date_trunc('month', CURRENT_DATE)
             ), 0) AS mtd_spend
        FROM cards c
        LEFT JOIN expenses ex ON ex.card_id = c.id
       GROUP BY c.id
      HAVING c.monthly_limit IS NOT NULL
         AND COALESCE(SUM(ex.amount) FILTER (
               WHERE date_trunc('month', ex.date) = date_trunc('month', CURRENT_DATE)
             ), 0) >= c.monthly_limit * c.alert_threshold_pct / 100.0
       ORDER BY mtd_spend DESC
       LIMIT 5
    `);

    const renewals = await pool.query(`
      SELECT id, name, asset_type, vendor, renewal_date,
             (renewal_date - CURRENT_DATE)::int AS days
        FROM assets
       WHERE is_recurring = true
         AND renewal_date IS NOT NULL
         AND renewal_date <= CURRENT_DATE + INTERVAL '30 days'
       ORDER BY renewal_date LIMIT 10
    `);

    const recentTx = await pool.query(`
      SELECT t.id, t.type, t.date_received, t.payment_method, t.gross_amount, t.fee_amount, t.net_amount, t.status,
             c.name AS client_name, e.legal_name AS entity_name
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id
        LEFT JOIN entities e ON e.id = t.entity_id
       ORDER BY t.created_at DESC LIMIT 10
    `);

    res.json({
      period: { from: dateFrom, to: dateTo, key: period },
      summary: summary.rows[0],
      today: today.rows[0],
      daily: dailyChart.rows,
      top_entities: topEntities.rows,
      method_mix: methodMix.rows,
      top_clients: topClients.rows,
      card_alerts: cardAlerts.rows,
      renewals: renewals.rows,
      recent_transactions: recentTx.rows,
    });
  } catch (err) {
    console.error('[dashboard]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/dashboard/client-balances ──────────────────────
// Per-client roll-up: Received, FP fee, Net, Paid out, Reserve held, Balance due.
// Balance due = Net earned - Paid out - Reserve held.
//   positive → we owe them; negative → they owe us.
router.get('/client-balances', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        c.id, c.name, c.country, c.status, c.balance_owed,
        COALESCE(SUM(t.gross_amount) FILTER (WHERE t.type = 'Received' AND t.is_deleted = false), 0)::float AS total_received,
        COALESCE(SUM(t.fee_amount)   FILTER (WHERE t.type = 'Received' AND t.is_deleted = false), 0)::float AS fp_fee,
        COALESCE(SUM(t.net_amount)   FILTER (WHERE t.type = 'Received' AND t.is_deleted = false), 0)::float AS net_earned,
        COALESCE((SELECT SUM(amount) FROM payouts WHERE client_id = c.id AND status = 'sent'), 0)::float    AS paid_out,
        COALESCE((SELECT SUM(amount - released_amount) FROM reserves
                   WHERE client_id = c.id AND status IN ('held','partially_released')), 0)::float          AS reserve_held,
        COUNT(t.id) FILTER (WHERE t.is_deleted = false)::int                                                AS tx_count
      FROM clients c
      LEFT JOIN transactions t ON t.client_id = c.id
      WHERE c.is_deleted = false
      GROUP BY c.id
      ORDER BY (
        COALESCE(SUM(t.net_amount)   FILTER (WHERE t.type = 'Received' AND t.is_deleted = false), 0)
        - COALESCE((SELECT SUM(amount) FROM payouts WHERE client_id = c.id AND status = 'sent'), 0)
        - COALESCE((SELECT SUM(amount - released_amount) FROM reserves
                     WHERE client_id = c.id AND status IN ('held','partially_released')), 0)
      ) DESC
    `);
    const rows = r.rows.map((x) => ({
      ...x,
      balance_due: +(parseFloat(x.net_earned) - parseFloat(x.paid_out) - parseFloat(x.reserve_held)).toFixed(2),
    }));
    const totals = rows.reduce((a, x) => ({
      total_received: a.total_received + parseFloat(x.total_received),
      fp_fee:         a.fp_fee + parseFloat(x.fp_fee),
      net_earned:     a.net_earned + parseFloat(x.net_earned),
      paid_out:       a.paid_out + parseFloat(x.paid_out),
      reserve_held:   a.reserve_held + parseFloat(x.reserve_held),
      balance_due:    a.balance_due + parseFloat(x.balance_due),
    }), { total_received: 0, fp_fee: 0, net_earned: 0, paid_out: 0, reserve_held: 0, balance_due: 0 });
    res.json({ rows, totals });
  } catch (err) {
    console.error('[dashboard client-balances]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
