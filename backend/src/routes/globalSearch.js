// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Global search — single GET that runs a fan-out across the
// most-searched tables (transactions, payment links, invoices,
// VT direct charges, clients, entities, cards) and returns a
// grouped result set. The frontend dropdown renders each group
// as its own section.
//
// Filters:
//   - For client_user role we restrict everything to their
//     client_id and skip non-customer-facing surfaces (cards,
//     entities, vt_transactions).
//   - q must be ≥ 2 chars; the route returns empty groups otherwise
//     so the frontend can short-circuit without a 400.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

const EMPTY = {
  transactions: [], paymentLinks: [], invoices: [], vtTransactions: [],
  clients: [], entities: [], cards: [],
};

router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json(EMPTY);

    const isClientUser = req.user.role === 'client_user';
    const clientId = req.user.client_id || null;
    const like = `%${q}%`;
    const isInt = /^\d+$/.test(q);
    const last4 = q.slice(-4);

    const txClientFilter = isClientUser ? `AND t.client_id = $2` : '';
    const plClientFilter = isClientUser ? `AND plr.client_id = $2` : '';
    const invClientFilter = isClientUser ? `AND inv.client_id = $2` : '';

    const params = isClientUser ? [like, clientId] : [like];

    const txQ = pool.query(`
      SELECT t.id, t.date_received, t.type, t.counterparty_name,
             t.gross_amount, t.status, t.client_id, t.notes, t.external_txn_id
        FROM transactions t
       WHERE (t.counterparty_name ILIKE $1
              OR t.notes ILIKE $1
              OR t.external_txn_id ILIKE $1
              ${isInt ? `OR t.id = ${parseInt(q, 10)}` : ''})
         ${txClientFilter}
       ORDER BY t.date_received DESC, t.id DESC
       LIMIT 6
    `, params);

    const plQ = pool.query(`
      SELECT plr.id, plr.token, plr.amount, plr.status, plr.created_at,
             plr.invoice_number, plr.customer_name, plr.customer_email,
             plr.description, plr.client_id,
             c.name AS client_name
        FROM payment_link_requests plr
        LEFT JOIN clients c ON c.id = plr.client_id
       WHERE (plr.invoice_number ILIKE $1
              OR plr.customer_email ILIKE $1
              OR plr.customer_name  ILIKE $1
              OR plr.description    ILIKE $1
              OR plr.token::text    ILIKE $1)
         ${plClientFilter}
       ORDER BY plr.created_at DESC
       LIMIT 6
    `, params);

    const invQ = pool.query(`
      SELECT inv.id, inv.invoice_number, inv.customer_name, inv.customer_email,
             inv.total_amount, inv.issue_date, inv.due_date, inv.client_id,
             c.name AS client_name
        FROM invoices inv
        LEFT JOIN clients c ON c.id = inv.client_id
       WHERE (inv.invoice_number ILIKE $1
              OR inv.customer_name  ILIKE $1
              OR inv.customer_email ILIKE $1)
         ${invClientFilter}
       ORDER BY inv.issue_date DESC, inv.invoice_number DESC
       LIMIT 6
    `, params);

    const vtQ = isClientUser ? Promise.resolve({ rows: [] }) : pool.query(`
      SELECT vt.id, vt.invoice_number, vt.card_holder_name,
             vt.processor_transaction_id, vt.amount, vt.status,
             vt.charge_type, vt.created_at, vt.transaction_id
        FROM vt_transactions vt
       WHERE vt.invoice_number              ILIKE $1
          OR vt.card_holder_name            ILIKE $1
          OR vt.processor_transaction_id    ILIKE $1
          OR vt.customer_email              ILIKE $1
       ORDER BY vt.created_at DESC
       LIMIT 6
    `, [like]);

    const clQ = isClientUser ? Promise.resolve({ rows: [] }) : pool.query(`
      SELECT id, name, email, balance_owed, status
        FROM clients
       WHERE name ILIKE $1 OR company_name ILIKE $1 OR email ILIKE $1
       LIMIT 6
    `, [like]);

    const enQ = isClientUser ? Promise.resolve({ rows: [] }) : pool.query(`
      SELECT id, legal_name, owner_name
        FROM entities
       WHERE legal_name ILIKE $1 OR owner_name ILIKE $1
       LIMIT 4
    `, [like]);

    const cdQ = isClientUser ? Promise.resolve({ rows: [] }) : pool.query(`
      SELECT id, nickname, last4, bank_name
        FROM cards
       WHERE nickname ILIKE $1 OR last4 = $2 OR bank_name ILIKE $1
       LIMIT 4
    `, [like, last4]);

    const [txs, pls, invs, vts, cls, ents, cards] = await Promise.all([
      txQ, plQ, invQ, vtQ, clQ, enQ, cdQ,
    ]);

    res.json({
      transactions: txs.rows,
      paymentLinks: pls.rows,
      invoices: invs.rows,
      vtTransactions: vts.rows,
      clients: cls.rows,
      entities: ents.rows,
      cards: cards.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
