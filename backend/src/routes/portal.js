// Portal routes — for client_user role only.
// Returns only data scoped to req.user.client_id, filtered by visibility settings.

const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role !== 'client_user') return res.status(403).json({ error: 'Portal is for client_user role only' });
  if (!req.user.client_id) return res.status(403).json({ error: 'No client_id assigned' });
  next();
});

// Filter a transaction row based on visibility settings
function applyVisibility(tx, vis) {
  const out = { id: tx.id, type: tx.type, date_received: tx.date_received, status: tx.status };
  if (vis.show_gross_amount)     out.gross_amount = tx.gross_amount;
  if (vis.show_customer_name)    out.counterparty_name = tx.counterparty_name;
  if (vis.show_merchant_fee)     out.merchant_charges = tx.merchant_charges;
  if (vis.show_commission)       { out.fee_amount = tx.fee_amount; out.foundapay_fee_pct = tx.foundapay_fee_pct; }
  if (vis.show_reserve_amount)   out.reserve_amount = tx.reserve_amount;
  if (vis.show_settlement_date)  out.funds_available_date = tx.funds_available_date;
  if (vis.show_processor_name)   out.processor_name = tx.processor_name;
  if (vis.show_entity_name)      out.entity_name = tx.entity_name;
  out.payment_method = tx.payment_method;
  out.net_amount = tx.net_amount;
  return out;
}

// ── GET /api/portal/me ───────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const cid = req.user.client_id;
    const cl = await pool.query('SELECT * FROM clients WHERE id = $1', [cid]);
    if (!cl.rows.length) return res.status(404).json({ error: 'Client not found' });

    let vis = (await pool.query('SELECT * FROM client_visibility_settings WHERE client_id = $1', [cid])).rows[0];
    if (!vis) {
      // create default
      await pool.query('INSERT INTO client_visibility_settings (client_id) VALUES ($1)', [cid]);
      vis = (await pool.query('SELECT * FROM client_visibility_settings WHERE client_id = $1', [cid])).rows[0];
    }

    const txs = await pool.query(`
      SELECT t.*, m.processor_name, e.legal_name AS entity_name
        FROM transactions t
        LEFT JOIN merchants m ON m.id = t.merchant_id
        LEFT JOIN entities e ON e.id = t.entity_id
       WHERE t.client_id = $1
       ORDER BY t.date_received DESC, t.id DESC LIMIT 200
    `, [cid]);
    const visibleTxs = txs.rows.map(t => applyVisibility(t, vis));

    const cards = await pool.query(`
      SELECT c.id, c.nickname, c.last4, c.bank_name, c.card_type, c.expiry, c.entity_id
        FROM client_card_assignments cca JOIN cards c ON c.id = cca.card_id
       WHERE cca.client_id = $1
    `, [cid]);

    let cardExpenses = [];
    if (cards.rows.length) {
      const cardIds = cards.rows.map(c => c.id);
      const ex = await pool.query(`
        SELECT id, date, amount, description, vendor, card_id FROM expenses WHERE card_id = ANY($1)
        ORDER BY date DESC LIMIT 100
      `, [cardIds]);
      cardExpenses = ex.rows;
    }

    const payouts = await pool.query(`
      SELECT id, amount, currency, payout_method, reference_number, status, sent_at, created_at, proof_url
        FROM payouts WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100
    `, [cid]);
    if (!vis.show_proof_files) payouts.rows.forEach(p => { delete p.proof_url; });

    const reserves = vis.show_reserve_amount ? (await pool.query(`
      SELECT id, amount, released_amount, status, hold_date, release_date FROM reserves
      WHERE client_id = $1 ORDER BY hold_date DESC LIMIT 50
    `, [cid])).rows : [];

    const chargebacks = vis.show_chargeback ? (await pool.query(`
      SELECT id, amount, reason, evidence_deadline, status, customer_name FROM chargebacks
      WHERE client_id = $1 ORDER BY created_at DESC
    `, [cid])).rows : [];

    const c = cl.rows[0];
    res.json({
      client: {
        id: c.id, name: c.name, company_name: c.company_name, email: c.email,
        country: c.country, status: c.status,
        balance_owed: vis.show_balance ? c.balance_owed : null,
        opening_balance: vis.show_balance ? c.opening_balance : null,
        commission_rates: vis.show_commission ? {
          card: c.card_pct, wire: c.wire_pct, cheque: c.cheque_pct, ach: c.ach_pct, zelle: c.zelle_pct,
        } : null,
      },
      visibility: vis,
      transactions: visibleTxs,
      assigned_cards: vis.show_card_assigned ? cards.rows : [],
      card_expenses: vis.show_card_assigned ? cardExpenses : [],
      payouts: vis.show_payout_status ? payouts.rows : [],
      reserves,
      chargebacks,
    });
  } catch (err) {
    console.error('[portal/me]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portal/terminal-access — does this client have VT access?
router.get('/terminal-access', async (req, res) => {
  try {
    if (!req.user.client_id) return res.json({ access: false });
    const r = await pool.query(
      'SELECT * FROM client_terminal_access WHERE client_id = $1',
      [req.user.client_id]
    );
    res.json({ access: r.rows[0] || false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
