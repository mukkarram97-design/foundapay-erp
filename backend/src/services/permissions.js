// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// User permission helpers — read-side only (writes happen in routes/permissions.js).
//
// getUserPermissions(userId)         → returns full row or null
// getCurrentUsage(userId, opts)      → today + this-period totals
// checkVtAllowed({ user, kind, amount, merchantId, today, periodTotals })
//                                    → { allowed: true } or
//                                      { allowed: false, reason, action }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { pool } = require('../db');

const SUPER_ROLES = ['super_admin', 'owner'];

// Permission row → defaults applied. Super admins / owners get an "allow-all" row.
async function getUserPermissions(userId, role) {
  if (SUPER_ROLES.includes(role)) {
    return {
      _superAllowAll: true,
      can_virtual_terminal: true, can_payment_links: true, can_invoices: true,
      can_master_ledger: true, can_reports: true, can_payouts: true,
      can_reconciliation: true, can_bank_accounts: true, can_remittance: true,
      can_clients: true, can_chargebacks: true, can_reserves: true,
      can_expenses: true, can_approvals: true,
      vt_direct_charge: true, vt_payment_links: true, vt_invoices: true,
      vt_merchants: [], // empty = all allowed for super
      vt_limit_per_transaction: 0, vt_limit_daily: 0, vt_limit_monthly: 0,
      vt_max_links_per_day: 0, vt_max_links_per_month: 0,
      vt_link_max_amount: 0, vt_link_auto_expire_hours: 24,
      limit_action: 'block', limit_reset_type: 'monthly_first',
      see_own_data_only: false, show_usage_to_user: true,
    };
  }
  const r = await pool.query('SELECT * FROM user_permissions WHERE user_id = $1', [userId]);
  return r.rows[0] || null;
}

// period_start/period_end for the user's reset config.
function periodWindow(reset_type) {
  const now = new Date();
  if (reset_type === 'rolling_30') {
    const start = new Date(now); start.setDate(start.getDate() - 30);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  // monthly_first: 1st of this month → last day of this month
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function getCurrentUsage(userId, perms) {
  const { start, end } = periodWindow(perms?.limit_reset_type || 'monthly_first');
  const todayDate = new Date().toISOString().slice(0, 10);

  // Live aggregates from vt_transactions + payment_link_requests + invoices.
  // Cheaper than maintaining user_usage on every write; the user_usage row is a
  // cache/optimisation we update opportunistically.
  const todayQ = pool.query(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0)::float AS charged_today
      FROM vt_transactions
     WHERE charged_by = $1 AND created_at::date = $2::date
  `, [userId, todayDate]);
  const periodQ = pool.query(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0)::float AS charged_period
      FROM vt_transactions
     WHERE charged_by = $1 AND created_at::date BETWEEN $2 AND $3
  `, [userId, start, end]);
  const linksTodayQ = pool.query(`
    SELECT COUNT(*)::int AS links_today
      FROM payment_link_requests
     WHERE created_by = $1 AND created_at::date = $2::date
  `, [userId, todayDate]);
  const linksPeriodQ = pool.query(`
    SELECT COUNT(*)::int AS links_period
      FROM payment_link_requests
     WHERE created_by = $1 AND created_at::date BETWEEN $2 AND $3
  `, [userId, start, end]);

  const [t, p, lt, lp] = await Promise.all([todayQ, periodQ, linksTodayQ, linksPeriodQ]);
  return {
    period: { start, end },
    charged: {
      today: t.rows[0].charged_today,
      this_period: p.rows[0].charged_period,
    },
    links: {
      today: lt.rows[0].links_today,
      this_period: lp.rows[0].links_period,
    },
  };
}

// Decide whether a VT action is allowed.
// kind ∈ 'direct' | 'link' | 'invoice'
// amount: gross USD; merchantId: target merchant; usage: getCurrentUsage(...) result
async function checkVtAllowed({ perms, kind, amount, merchantId, usage }) {
  if (perms?._superAllowAll) return { allowed: true };
  if (!perms) return { allowed: false, reason: 'No permissions configured for your account', action: 'block' };
  if (!perms.can_virtual_terminal) return { allowed: false, reason: 'Virtual Terminal access disabled', action: 'block' };

  if (kind === 'direct'  && !perms.vt_direct_charge)  return { allowed: false, reason: 'Direct Charge disabled for your account', action: 'block' };
  if (kind === 'link'    && !perms.vt_payment_links)  return { allowed: false, reason: 'Payment Links disabled for your account', action: 'block' };
  if (kind === 'invoice' && !perms.vt_invoices)       return { allowed: false, reason: 'Invoices disabled for your account', action: 'block' };

  // Merchant whitelist (empty list means: nothing allowed)
  const merchantList = Array.isArray(perms.vt_merchants) ? perms.vt_merchants : [];
  if (merchantId && merchantList.length > 0 && !merchantList.includes(merchantId)) {
    return { allowed: false, reason: 'Selected merchant is not in your allowed list', action: 'block' };
  }

  const amt = parseFloat(amount) || 0;
  // Per-transaction
  if (perms.vt_limit_per_transaction > 0 && amt > parseFloat(perms.vt_limit_per_transaction)) {
    return { allowed: false, reason: `Exceeds your per-transaction limit of $${parseFloat(perms.vt_limit_per_transaction).toFixed(2)}`, action: perms.limit_action || 'block' };
  }
  // Daily
  if (perms.vt_limit_daily > 0) {
    const proj = (usage?.charged?.today || 0) + amt;
    if (proj > parseFloat(perms.vt_limit_daily)) {
      return { allowed: false, reason: `Daily limit $${parseFloat(perms.vt_limit_daily).toFixed(2)} would be exceeded (today so far: $${(usage?.charged?.today || 0).toFixed(2)})`, action: perms.limit_action || 'block' };
    }
  }
  // Monthly / period
  if (perms.vt_limit_monthly > 0) {
    const proj = (usage?.charged?.this_period || 0) + amt;
    if (proj > parseFloat(perms.vt_limit_monthly)) {
      return { allowed: false, reason: `Monthly limit $${parseFloat(perms.vt_limit_monthly).toFixed(2)} would be exceeded (this period: $${(usage?.charged?.this_period || 0).toFixed(2)})`, action: perms.limit_action || 'block' };
    }
  }
  if (kind === 'link') {
    if (perms.vt_link_max_amount > 0 && amt > parseFloat(perms.vt_link_max_amount)) {
      return { allowed: false, reason: `Link amount exceeds your max of $${parseFloat(perms.vt_link_max_amount).toFixed(2)}`, action: perms.limit_action || 'block' };
    }
    if (perms.vt_max_links_per_day > 0 && (usage?.links?.today || 0) >= perms.vt_max_links_per_day) {
      return { allowed: false, reason: `You've already created ${perms.vt_max_links_per_day} links today (daily max)`, action: perms.limit_action || 'block' };
    }
    if (perms.vt_max_links_per_month > 0 && (usage?.links?.this_period || 0) >= perms.vt_max_links_per_month) {
      return { allowed: false, reason: `You've already created ${perms.vt_max_links_per_month} links this period`, action: perms.limit_action || 'block' };
    }
  }
  return { allowed: true };
}

module.exports = { getUserPermissions, getCurrentUsage, checkVtAllowed, periodWindow };
