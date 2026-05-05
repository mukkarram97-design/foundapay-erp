const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

// GET /api/notifications — list (last 50, derived live)
router.get('/', async (req, res) => {
  try {
    const items = await deriveNotifications(req.user);
    res.json({ rows: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const items = await deriveNotifications(req.user);
    res.json({ count: items.filter(n => !n.read).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/mark-all-read
router.post('/mark-all-read', async (req, res) => {
  // We derive notifications live (no persistence yet) so this is a no-op
  res.json({ ok: true });
});

// Derive notifications live from system state
async function deriveNotifications(user) {
  if (user.role === 'client_user') return [];
  const out = [];

  // Open chargebacks with deadlines
  const cb = await pool.query(`
    SELECT cb.id, cb.amount, cb.evidence_deadline, cb.customer_name, c.name AS client_name,
           (cb.evidence_deadline - CURRENT_DATE)::int AS days_left
      FROM chargebacks cb LEFT JOIN clients c ON c.id = cb.client_id
     WHERE cb.status IN ('open','evidence_submitted')
     ORDER BY cb.evidence_deadline NULLS LAST LIMIT 10
  `);
  for (const r of cb.rows) {
    out.push({
      id: `cb-${r.id}`, type: 'chargeback', tone: 'danger',
      title: `Chargeback: $${parseFloat(r.amount).toFixed(2)} from ${r.client_name || r.customer_name || 'unknown'}`,
      message: r.days_left != null
        ? (r.days_left < 0 ? `Evidence overdue by ${-r.days_left} days` : `Evidence due in ${r.days_left} days`)
        : 'Evidence deadline not set',
      link: `/chargebacks`,
      created_at: new Date().toISOString(),
      read: false,
    });
  }

  // Card alerts (>= threshold% of monthly limit)
  const cards = await pool.query(`
    SELECT c.id, c.nickname, c.last4, c.monthly_limit, c.alert_threshold_pct,
           COALESCE(SUM(ex.amount) FILTER (
             WHERE date_trunc('month', ex.date) = date_trunc('month', CURRENT_DATE)
           ), 0) AS mtd_spend
      FROM cards c LEFT JOIN expenses ex ON ex.card_id = c.id
     WHERE c.monthly_limit IS NOT NULL
     GROUP BY c.id
    HAVING COALESCE(SUM(ex.amount) FILTER (
             WHERE date_trunc('month', ex.date) = date_trunc('month', CURRENT_DATE)
           ), 0) >= c.monthly_limit * c.alert_threshold_pct / 100.0
     LIMIT 10
  `);
  for (const r of cards.rows) {
    const pct = Math.round((parseFloat(r.mtd_spend) / parseFloat(r.monthly_limit)) * 100);
    out.push({
      id: `card-${r.id}`, type: 'card_limit', tone: 'warning',
      title: `Card near limit: ${r.nickname} ••${r.last4}`,
      message: `${pct}% of $${r.monthly_limit} used this month`,
      link: '/cards',
      created_at: new Date().toISOString(),
      read: false,
    });
  }

  // Asset renewals within 7 days
  const assets = await pool.query(`
    SELECT id, name, renewal_date, (renewal_date - CURRENT_DATE)::int AS days
      FROM assets
     WHERE is_recurring = true AND renewal_date IS NOT NULL
       AND renewal_date <= CURRENT_DATE + INTERVAL '7 days'
     ORDER BY renewal_date LIMIT 10
  `);
  for (const r of assets.rows) {
    out.push({
      id: `asset-${r.id}`, type: 'renewal', tone: 'warning',
      title: `Renewing in ${r.days} days: ${r.name}`,
      message: `Asset renews ${r.renewal_date.toISOString().slice(0, 10)}`,
      link: '/assets',
      created_at: new Date().toISOString(),
      read: false,
    });
  }

  // Payouts at admin_approval stage
  const payouts = await pool.query(`
    SELECT p.id, p.amount, p.currency, c.name AS client_name
      FROM payouts p LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.status = 'admin_approval'
     ORDER BY p.created_at DESC LIMIT 10
  `);
  for (const r of payouts.rows) {
    out.push({
      id: `payout-${r.id}`, type: 'payout_approval', tone: 'accent',
      title: `Payout awaiting approval: ${r.currency} ${parseFloat(r.amount).toFixed(2)} → ${r.client_name}`,
      message: 'Click to review and approve',
      link: '/payouts',
      created_at: new Date().toISOString(),
      read: false,
    });
  }

  return out.sort((a, b) => (a.tone === 'danger' ? -1 : 1));
}

module.exports = router;
