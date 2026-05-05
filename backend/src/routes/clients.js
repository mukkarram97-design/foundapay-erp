const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { buildStatement } = require('../services/pdfReceipt');

const router = express.Router();
router.use(authRequired);

// Block client_user from listing all clients — they get /api/portal/me instead
function blockClientUser(req, res, next) {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ── GET /api/clients ─────────────────────────────────────────
router.get('/', blockClientUser, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.*,
             COALESCE(SUM(t.gross_amount) FILTER (WHERE t.type = 'Received'), 0) AS total_gross_received,
             COALESCE(SUM(t.fee_amount)   FILTER (WHERE t.type = 'Received'), 0) AS total_revenue,
             COUNT(t.id) AS tx_count
        FROM clients c
        LEFT JOIN transactions t ON t.client_id = c.id
       GROUP BY c.id
       ORDER BY c.name
    `);
    res.json({ rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/clients/:id ─────────────────────────────────────
router.get('/:id', blockClientUser, async (req, res) => {
  try {
    const cr = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!cr.rows.length) return res.status(404).json({ error: 'Not found' });
    const vr = await pool.query('SELECT * FROM client_visibility_settings WHERE client_id = $1', [req.params.id]);
    const ccr = await pool.query(`
      SELECT cca.id AS assignment_id, c.* FROM client_card_assignments cca
        JOIN cards c ON c.id = cca.card_id
       WHERE cca.client_id = $1
    `, [req.params.id]);
    res.json({ client: cr.rows[0], visibility: vr.rows[0] || null, cards: ccr.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/clients ────────────────────────────────────────
router.post('/', blockClientUser, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`
      INSERT INTO clients
        (name, company_name, contact_person, email, phone, whatsapp, country, status,
         card_pct, wire_pct, cheque_pct, ach_pct, zelle_pct,
         other_terms, opening_balance, balance_owed, settlement_cycle, notes)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'Pakistan'),COALESCE($8,'active'),
              COALESCE($9::numeric,0),COALESCE($10::numeric,0),COALESCE($11::numeric,0),COALESCE($12::numeric,0),COALESCE($13::numeric,0),
              $14,COALESCE($15::numeric,0),COALESCE($16::numeric,0),COALESCE($17,'weekly'),$18)
      RETURNING *
    `, [
      b.name, b.company_name || null, b.contact_person || null, b.email || null, b.phone || null,
      b.whatsapp || null, b.country, b.status,
      b.card_pct, b.wire_pct, b.cheque_pct, b.ach_pct, b.zelle_pct,
      b.other_terms || null, b.opening_balance, b.balance_owed, b.settlement_cycle, b.notes || null,
    ]);
    await pool.query('INSERT INTO client_visibility_settings (client_id) VALUES ($1)', [r.rows[0].id]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/clients/:id ───────────────────────────────────
router.patch('/:id', blockClientUser, async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['name','company_name','contact_person','email','phone','whatsapp','country','status',
      'card_pct','wire_pct','cheque_pct','ach_pct','zelle_pct','other_terms','opening_balance',
      'balance_owed','our_revenue','settlement_cycle','notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE clients SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/clients/:id/visibility ────────────────────────
router.patch('/:id/visibility', blockClientUser, async (req, res) => {
  try {
    const fields = ['show_gross_amount','show_customer_name','show_customer_email','show_merchant_fee',
      'show_commission','show_reserve_amount','show_chargeback','show_settlement_date',
      'show_processor_name','show_entity_name','show_bank_account','show_payout_status',
      'show_balance','show_statement_download','show_proof_files','show_card_assigned'];
    const b = req.body || {};
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No visibility fields to update' });
    params.push(req.params.id);
    let r = await pool.query(
      `UPDATE client_visibility_settings SET ${sets.join(', ')} WHERE client_id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) {
      await pool.query('INSERT INTO client_visibility_settings (client_id) VALUES ($1)', [req.params.id]);
      r = await pool.query(
        `UPDATE client_visibility_settings SET ${sets.join(', ')} WHERE client_id = $${params.length} RETURNING *`,
        params
      );
    }
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/clients/:id/portal-data ─────────────────────────
// Same data as /api/portal/me but addressable by client id.
// Client_user role is allowed only when :id matches their own client_id.
router.get('/:id/portal-data', async (req, res) => {
  try {
    if (req.user.role === 'client_user' && req.params.id !== req.user.client_id) {
      return res.status(403).json({ error: 'Forbidden — outside client scope' });
    }
    const cid = req.params.id;
    const cl = await pool.query('SELECT * FROM clients WHERE id = $1', [cid]);
    if (!cl.rows.length) return res.status(404).json({ error: 'Client not found' });

    let vis = (await pool.query('SELECT * FROM client_visibility_settings WHERE client_id = $1', [cid])).rows[0];
    if (!vis) {
      await pool.query('INSERT INTO client_visibility_settings (client_id) VALUES ($1)', [cid]);
      vis = (await pool.query('SELECT * FROM client_visibility_settings WHERE client_id = $1', [cid])).rows[0];
    }

    const txs = await pool.query(`
      SELECT t.*, m.processor_name, e.legal_name AS entity_name
        FROM transactions t
        LEFT JOIN merchants m ON m.id = t.merchant_id
        LEFT JOIN entities e ON e.id = t.entity_id
       WHERE t.client_id = $1
       ORDER BY t.date_received DESC, t.id DESC LIMIT 500
    `, [cid]);

    const cards = await pool.query(`
      SELECT c.id, c.nickname, c.last4, c.bank_name, c.card_type, c.expiry, c.entity_id
        FROM client_card_assignments cca JOIN cards c ON c.id = cca.card_id
       WHERE cca.client_id = $1
    `, [cid]);

    const cardIds = cards.rows.map((c) => c.id);
    const cardExpenses = cardIds.length
      ? (await pool.query(`
          SELECT id, date, amount, description, vendor, card_id FROM expenses
           WHERE card_id = ANY($1) ORDER BY date DESC LIMIT 100
        `, [cardIds])).rows
      : [];

    const payouts = await pool.query(`
      SELECT id, amount, currency, payout_method, reference_number, status, sent_at, created_at, proof_url
        FROM payouts WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100
    `, [cid]);

    const reserves = await pool.query(`
      SELECT id, transaction_id, amount, released_amount, status, hold_date, release_date FROM reserves
       WHERE client_id = $1 ORDER BY hold_date DESC LIMIT 100
    `, [cid]);

    const chargebacks = await pool.query(`
      SELECT id, amount, reason, evidence_deadline, evidence_uploaded, status, customer_name, cb_fee
        FROM chargebacks WHERE client_id = $1 ORDER BY created_at DESC
    `, [cid]);

    const paymentLinks = await pool.query(`
      SELECT id, request_number, customer_name, customer_email, amount, currency,
             payment_method, status, processor_link, created_at, link_sent_at
        FROM payment_link_requests WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100
    `, [cid]);

    // Live aggregates
    const totals = await pool.query(`
      SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Received'), 0)::numeric(15,2) AS total_received,
        COALESCE(SUM(reserve_amount) FILTER (WHERE type = 'Received'), 0)::numeric(15,2) AS reserve_held
      FROM transactions WHERE client_id = $1
    `, [cid]);

    const c = cl.rows[0];
    res.json({
      client: {
        id: c.id, name: c.name, company_name: c.company_name, email: c.email, phone: c.phone,
        country: c.country, status: c.status,
        balance_owed: c.balance_owed,
        opening_balance: c.opening_balance,
        commission_rates: vis.show_commission ? {
          card: c.card_pct, wire: c.wire_pct, cheque: c.cheque_pct, ach: c.ach_pct, zelle: c.zelle_pct,
        } : null,
      },
      balance: {
        current_balance: c.balance_owed,
        reserve_held: totals.rows[0].reserve_held,
        total_received: totals.rows[0].total_received,
      },
      visibility: vis,
      transactions: txs.rows,
      payment_links: paymentLinks.rows,
      payouts: payouts.rows,
      reserves: reserves.rows,
      chargebacks: chargebacks.rows,
      assigned_cards: cards.rows,
      card_expenses: cardExpenses,
    });
  } catch (err) {
    console.error('[clients/portal-data]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/clients/:id/statement?from=&to=&format=json|pdf ─
// Allowed for staff. client_user allowed only when :id matches their own client_id.
router.get('/:id/statement', async (req, res) => {
  try {
    if (req.user.role === 'client_user' && req.params.id !== req.user.client_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { from, to, format } = req.query;
    const params = [req.params.id];
    let dateFilter = '';
    if (from) { params.push(from); dateFilter += ` AND date_received >= $${params.length}`; }
    if (to)   { params.push(to);   dateFilter += ` AND date_received <= $${params.length}`; }

    const cl = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!cl.rows.length) return res.status(404).json({ error: 'Client not found' });

    const txs = await pool.query(`
      SELECT * FROM transactions WHERE client_id = $1 ${dateFilter}
      ORDER BY date_received DESC, id DESC
    `, params);
    const totals = await pool.query(`
      SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Received'), 0) AS gross_received,
        COALESCE(SUM(fee_amount) FILTER (WHERE type = 'Received'), 0)   AS commission,
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Paid'), 0)     AS paid_out,
        COALESCE(SUM(reserve_amount), 0)                                AS reserve_held
      FROM transactions WHERE client_id = $1 ${dateFilter}
    `, params);

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition',
        `attachment; filename="FoundaPay-Statement-${cl.rows[0].name.replace(/\s+/g, '_')}-${from || 'all'}-to-${to || 'all'}.pdf"`);
      buildStatement({
        client: cl.rows[0],
        period: { from: from || '—', to: to || '—' },
        transactions: txs.rows,
        totals: totals.rows[0],
      }, res);
      return;
    }

    res.json({ client: cl.rows[0], transactions: txs.rows, totals: totals.rows[0] });
  } catch (err) {
    console.error('[clients/statement]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/clients/:id/assign-card ────────────────────────
router.post('/:id/assign-card', blockClientUser, async (req, res) => {
  try {
    const { card_id, notes } = req.body || {};
    if (!card_id) return res.status(400).json({ error: 'card_id required' });
    const r = await pool.query(`
      INSERT INTO client_card_assignments (client_id, card_id, assigned_by, notes)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [req.params.id, card_id, req.user.id, notes || null]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/cards/:cardId', blockClientUser, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM client_card_assignments WHERE client_id = $1 AND card_id = $2',
      [req.params.id, req.params.cardId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
