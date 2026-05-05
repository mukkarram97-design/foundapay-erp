const express = require('express');
const { pool } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const eng = require('../services/transactionEngine');
const { buildReceipt } = require('../services/pdfReceipt');

const router = express.Router();
router.use(authRequired);

// ── GET /api/transactions/:id/receipt — PDF download ────────
// Allowed for staff AND for client_user (only their own client's tx).
router.get('/:id/receipt', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const r = await pool.query(`
      SELECT t.*, c.name AS client_name, e.legal_name AS entity_name, m.processor_name
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id
        LEFT JOIN entities e ON e.id = t.entity_id
        LEFT JOIN merchants m ON m.id = t.merchant_id
       WHERE t.id = $1
    `, [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const tx = r.rows[0];
    if (req.user.role === 'client_user' && tx.client_id !== req.user.client_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="FoundaPay-Receipt-TXN${id}.pdf"`);
    buildReceipt(tx, { entity_name: tx.entity_name, processor_name: tx.processor_name }, res);
  } catch (err) {
    console.error('[tx/receipt]', err);
    res.status(500).json({ error: err.message });
  }
});

// Block client_user from the rest of this resource
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

// ── GET /api/transactions ────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { client_id, entity_id, type, status, method, from, to, search, limit = 1000, offset = 0 } = req.query;
    const where = [];
    const params = [];
    if (client_id) { params.push(client_id); where.push(`t.client_id = $${params.length}`); }
    if (entity_id) { params.push(entity_id); where.push(`t.entity_id = $${params.length}`); }
    if (type)      { params.push(type);      where.push(`t.type = $${params.length}`); }
    if (status)    { params.push(status);    where.push(`t.status = $${params.length}`); }
    if (method)    { params.push(method);    where.push(`t.payment_method = $${params.length}`); }
    if (from)      { params.push(from);      where.push(`t.date_received >= $${params.length}`); }
    if (to)        { params.push(to);        where.push(`t.date_received <= $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(t.counterparty_name ILIKE $${params.length} OR t.notes ILIKE $${params.length} OR t.external_txn_id ILIKE $${params.length})`);
    }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);
    const sql = `
      SELECT t.*, c.name AS client_name, e.legal_name AS entity_name, m.processor_name
        FROM transactions t
        LEFT JOIN clients  c ON c.id = t.client_id
        LEFT JOIN entities e ON e.id = t.entity_id
        LEFT JOIN merchants m ON m.id = t.merchant_id
        ${whereSQL}
        ORDER BY t.date_received DESC, t.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows, count: r.rows.length });
  } catch (err) {
    console.error('[tx/list]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/summary ────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = [];
    const params = [];
    if (from) { params.push(from); where.push(`date_received >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`date_received <= $${params.length}`); }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE type = 'Received')                                 AS received_count,
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Received'), 0)           AS gross_received,
        COALESCE(SUM(fee_amount)   FILTER (WHERE type = 'Received'), 0)           AS revenue,
        COALESCE(SUM(gross_amount) FILTER (WHERE type = 'Paid'), 0)               AS paid_out,
        COUNT(*) FILTER (WHERE status = 'Hold')                                   AS on_hold_count,
        COUNT(*) FILTER (WHERE status = 'Charge Back')                            AS chargeback_count
      FROM transactions ${whereSQL}
    `, params);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transactions/export?format=csv ──────────────────
router.get('/export', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT t.id, t.type, t.date_received, c.name AS client, t.counterparty_name,
             t.payment_method, e.legal_name AS entity, m.processor_name,
             t.gross_amount, t.foundapay_fee_pct, t.fee_amount,
             t.merchant_charges, t.reserve_amount, t.net_amount, t.status, t.notes
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id
        LEFT JOIN entities e ON e.id = t.entity_id
        LEFT JOIN merchants m ON m.id = t.merchant_id
        ORDER BY t.date_received DESC, t.id DESC
    `);
    const headers = Object.keys(r.rows[0] || { id: 1 });
    const escape = (v) => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const row of r.rows) lines.push(headers.map(h => escape(row[h])).join(','));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/transactions ───────────────────────────────────
// Auto-fills foundapay_fee_pct from client rates if blank, computes net.
router.post('/', async (req, res) => {
  const c = await pool.connect();
  try {
    const b = req.body || {};
    if (!b.type || !b.gross_amount) {
      return res.status(400).json({ error: 'type and gross_amount are required' });
    }

    let client = null;
    if (b.client_id) {
      const cr = await c.query('SELECT * FROM clients WHERE id = $1', [b.client_id]);
      client = cr.rows[0];
    }

    // Auto-fill fee % if not provided
    let feePct = b.foundapay_fee_pct;
    if (feePct == null && client && b.payment_method) {
      feePct = eng.autoLookupCommissionPct(client, b.payment_method);
    }
    feePct = parseFloat(feePct) || 0;

    // Auto-apply reserve rule if client matches
    let reservePct = parseFloat(b.reserve_pct) || 0;
    if (!reservePct && client) {
      const rule = eng.getReserveRule(client.name);
      if (rule) reservePct = rule.pct;
    }

    const calc = eng.calculateNet({
      ...b,
      foundapay_fee_pct: feePct,
      reserve_pct: reservePct,
    });

    const fundsDate = b.funds_available_date || eng.defaultFundsAvailableDate(b.date_received);

    const r = await c.query(`
      INSERT INTO transactions
        (type, date_received, client_id, counterparty_type, counterparty_name,
         entity_id, merchant_id, payment_method, sending_method, company_name, merchant_account,
         gross_amount, foundapay_fee_pct, fee_amount, merchant_charges, bearing_merchant_charges,
         net_amount, funds_available_date, processor_fee_pct, processor_fee_amount, processor_fee_bearer,
         reserve_pct, reserve_amount, reserve_bearer, status, external_txn_id, processor_reference,
         notes, created_by)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
      RETURNING *
    `, [
      b.type, b.date_received || new Date().toISOString().slice(0,10),
      b.client_id || null, b.counterparty_type || null, b.counterparty_name || (client?.name) || null,
      b.entity_id || null, b.merchant_id || null, b.payment_method || null, b.sending_method || null,
      b.company_name || null, b.merchant_account || null,
      calc.gross, feePct, calc.fee_amount, calc.merchant_charges, b.bearing_merchant_charges || 'Client',
      calc.net_amount, fundsDate,
      parseFloat(b.processor_fee_pct) || 0, calc.processor_fee_amount, b.processor_fee_bearer || 'Client',
      reservePct, calc.reserve_amount, b.reserve_bearer || 'Client',
      b.status || 'Completed', b.external_txn_id || null, b.processor_reference || null,
      b.notes || null, req.user.id,
    ]);

    // Auto-create reserve row if reserve was applied
    if (calc.reserve_amount > 0) {
      const reserveRule = client ? eng.getReserveRule(client.name) : null;
      await c.query(`
        INSERT INTO reserves
          (transaction_id, client_id, merchant_id, amount, bearer, reserve_type, hold_date, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'held')
      `, [
        r.rows[0].id, b.client_id || null, b.merchant_id || null, calc.reserve_amount,
        b.reserve_bearer || 'Client', reserveRule?.label || 'Reserve hold',
        b.date_received || new Date().toISOString().slice(0,10),
      ]);
    }

    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[tx/create]', err);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ── PATCH /api/transactions/:id ──────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const fields = [
      'type','date_received','client_id','counterparty_type','counterparty_name','entity_id',
      'merchant_id','payment_method','company_name','merchant_account','gross_amount',
      'foundapay_fee_pct','fee_amount','merchant_charges','bearing_merchant_charges','net_amount',
      'processor_fee_pct','reserve_pct','reserve_amount','status','notes','external_txn_id'
    ];

    // Recompute net if any monetary field changed
    if (b.gross_amount != null || b.foundapay_fee_pct != null || b.merchant_charges != null
        || b.processor_fee_pct != null || b.reserve_pct != null) {
      const cur = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
      const merged = { ...cur.rows[0], ...b };
      const calc = eng.calculateNet(merged);
      Object.assign(b, {
        gross_amount: calc.gross,
        fee_amount: calc.fee_amount,
        merchant_charges: calc.merchant_charges,
        net_amount: calc.net_amount,
        processor_fee_amount: calc.processor_fee_amount,
        reserve_amount: calc.reserve_amount,
      });
      fields.push('processor_fee_amount');
    }

    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const r = await pool.query(
      `UPDATE transactions SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/transactions/:id (super_admin only) ─────────
router.delete('/:id', requireRole('super_admin'), async (req, res) => {
  const c = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    await c.query('BEGIN');
    const cur = await c.query('SELECT * FROM transactions WHERE id = $1', [id]);
    if (!cur.rows.length) {
      await c.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const tx = cur.rows[0];

    // Audit BEFORE delete (preserves the row content)
    await c.query(
      `INSERT INTO audit_logs (user_id, action, resource, resource_id, old_value, ip_address)
       VALUES ($1, 'DELETE_TRANSACTION', 'transactions', $2, $3, $4)`,
      [req.user.id, String(id), JSON.stringify(tx), req.ip || null]
    );

    await c.query('DELETE FROM reserves WHERE transaction_id = $1', [id]);
    await c.query('DELETE FROM chargebacks WHERE transaction_id = $1', [id]);
    await c.query('DELETE FROM transactions WHERE id = $1', [id]);
    await c.query('COMMIT');

    res.json({
      message: 'Transaction deleted',
      id: tx.id,
      gross_amount: tx.gross_amount,
      counterparty_name: tx.counterparty_name,
    });
  } catch (err) {
    await c.query('ROLLBACK');
    console.error('[tx/delete]', err);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ── POST /api/transactions/bulk-delete (super_admin only) ───
router.post('/bulk-delete', requireRole('super_admin'), async (req, res) => {
  const c = await pool.connect();
  try {
    const ids = ((req.body || {}).ids || []).map((n) => parseInt(n, 10)).filter(Number.isFinite);
    if (!ids.length) return res.status(400).json({ error: 'ids array required' });

    await c.query('BEGIN');
    const cur = await c.query('SELECT * FROM transactions WHERE id = ANY($1)', [ids]);
    const found = cur.rows;

    for (const tx of found) {
      await c.query(
        `INSERT INTO audit_logs (user_id, action, resource, resource_id, old_value, ip_address)
         VALUES ($1, 'DELETE_TRANSACTION', 'transactions', $2, $3, $4)`,
        [req.user.id, String(tx.id), JSON.stringify(tx), req.ip || null]
      );
    }
    await c.query('DELETE FROM reserves WHERE transaction_id = ANY($1)', [ids]);
    await c.query('DELETE FROM chargebacks WHERE transaction_id = ANY($1)', [ids]);
    const del = await c.query('DELETE FROM transactions WHERE id = ANY($1) RETURNING id', [ids]);
    await c.query('COMMIT');

    res.json({
      message: 'Bulk delete completed',
      deleted: del.rows.map((r) => r.id),
      requested: ids.length,
      not_found: ids.filter((id) => !found.some((f) => f.id === id)),
    });
  } catch (err) {
    await c.query('ROLLBACK');
    console.error('[tx/bulk-delete]', err);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ── POST /api/transactions/:id/proof — set proof URL ────────
router.post('/:id/proof', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const url = (req.body || {}).url;
    if (!url) return res.status(400).json({ error: 'url required' });
    const r = await pool.query(
      'UPDATE transactions SET proof_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, proof_url',
      [url, id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/transactions/bulk-import ───────────────────────
// Accepts: { rows: [...] } where each row has the same shape as POST /
router.post('/bulk-import', async (req, res) => {
  const c = await pool.connect();
  try {
    const rows = (req.body && req.body.rows) || [];
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows array required' });

    await c.query('BEGIN');
    let inserted = 0, skipped = 0, errors = [];

    // Cache clients & entities & merchants for name resolution
    const clientByName = {};
    (await c.query('SELECT id, name, card_pct, wire_pct, cheque_pct, ach_pct, zelle_pct FROM clients')).rows
      .forEach(r => { clientByName[r.name] = r; });
    const entityByName = {};
    (await c.query('SELECT id, legal_name FROM entities')).rows.forEach(r => { entityByName[r.legal_name] = r.id; });
    const merchantByPair = {}; // processor_name|entity_id → id
    (await c.query('SELECT id, processor_name, entity_id FROM merchants')).rows
      .forEach(r => { merchantByPair[`${r.processor_name}|${r.entity_id}`] = r.id; });

    for (let i = 0; i < rows.length; i++) {
      const b = rows[i];
      try {
        let clientId = b.client_id;
        let client = null;
        if (!clientId && b.counterparty_name) {
          client = clientByName[b.counterparty_name];
          if (client) clientId = client.id;
        } else if (clientId) {
          client = Object.values(clientByName).find(c => c.id === clientId);
        }

        let entityId = b.entity_id;
        if (!entityId && b.company_name) entityId = entityByName[b.company_name] || null;

        let merchantId = b.merchant_id || null;
        if (!merchantId && b.merchant_account && entityId) {
          merchantId = merchantByPair[`${b.merchant_account}|${entityId}`] || null;
        }

        let feePct = b.foundapay_fee_pct;
        if (feePct == null && client && b.payment_method) {
          feePct = eng.autoLookupCommissionPct(client, b.payment_method);
        }
        feePct = parseFloat(feePct) || 0;

        let reservePct = parseFloat(b.reserve_pct) || 0;
        if (!reservePct && client) {
          const rule = eng.getReserveRule(client.name);
          if (rule) reservePct = rule.pct;
        }

        const calc = eng.calculateNet({ ...b, foundapay_fee_pct: feePct, reserve_pct: reservePct });

        await c.query(`
          INSERT INTO transactions
            (type, date_received, client_id, counterparty_type, counterparty_name,
             entity_id, merchant_id, payment_method, company_name, merchant_account,
             gross_amount, foundapay_fee_pct, fee_amount, merchant_charges, bearing_merchant_charges,
             net_amount, funds_available_date, reserve_pct, reserve_amount, status,
             external_txn_id, notes, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        `, [
          b.type || 'Received',
          b.date_received,
          clientId, b.counterparty_type || 'Client', b.counterparty_name || client?.name || null,
          entityId, merchantId, b.payment_method || null, b.company_name || null, b.merchant_account || null,
          calc.gross, feePct, calc.fee_amount, calc.merchant_charges, b.bearing_merchant_charges || 'Client',
          calc.net_amount, b.funds_available_date || eng.defaultFundsAvailableDate(b.date_received),
          reservePct, calc.reserve_amount, b.status || 'Completed',
          b.external_txn_id || null, b.notes || null, req.user.id,
        ]);
        inserted++;
      } catch (e) {
        skipped++;
        errors.push({ index: i, error: e.message });
      }
    }
    await c.query('COMMIT');
    res.json({ inserted, skipped, errors: errors.slice(0, 20) });
  } catch (err) {
    await c.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

module.exports = router;
