// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bank Accounts — CRUD + manual balance + CSV import + Plaid Link/sync.
//
// Endpoints under /api/banks (authRequired, staff only):
//   GET    /                          list bank accounts (with balance + tx count)
//   POST   /                          create bank account (manual)
//   GET    /:id                       detail + recent bank_transactions
//   PUT    /:id                       update (incl. manual balance override)
//   DELETE /:id                       soft-delete
//   POST   /:id/csv                   upload CSV (multipart) of bank statement rows
//   GET    /:id/transactions          paginated bank_transactions
//
// Plaid:
//   POST /plaid/link-token            Create link_token for the frontend
//   POST /plaid/exchange              Exchange public_token + create bank_accounts row + plaid_items row
//   POST /:id/plaid/sync              Pull latest transactions via /transactions/sync
//   POST /:id/plaid/refresh-balance   Refresh balance via /accounts/balance/get
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const plaid = require('../services/plaid');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (req.user.role === 'client_user') return res.status(403).json({ error: 'Forbidden' });
  next();
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ━━━ GET /api/banks ━━━
// Returns all non-deleted bank accounts AND, when Wise is configured, prepends
// a synthetic Wise row (id='wise-nextgenase', is_wise=true) so the frontend
// renders Wise as just another bank card. Wise balance fetch is best-effort —
// if Wise is down or returns an error, the synthetic row is omitted.
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT b.*, e.legal_name AS entity_name,
             COALESCE((
               SELECT COUNT(*) FROM bank_transactions bt
                WHERE bt.bank_account_id = b.id AND bt.is_deleted = false
             ), 0)::int AS tx_count,
             EXISTS(SELECT 1 FROM plaid_items pi WHERE pi.bank_account_id = b.id) AS plaid_connected
        FROM bank_accounts b
        LEFT JOIN entities e ON e.id = b.entity_id
       WHERE b.is_deleted = false
       ORDER BY b.created_at DESC
    `);

    const rows = r.rows;

    // Append Wise synthetic row at the head of the list when configured.
    try {
      const wise = require('../services/wise');
      if (wise.isConfigured()) {
        const balances = await wise.getBalances();
        const list = Array.isArray(balances) ? balances : [];
        const usd = list.find((b) => (b.currency || b.amount?.currency) === 'USD');
        const usdBalance = parseFloat(usd?.amount?.value ?? usd?.amount ?? 0) || 0;
        const extraBalances = list
          .filter((b) => (b.currency || b.amount?.currency) !== 'USD')
          .map((b) => ({
            currency: b.currency || b.amount?.currency || 'UNK',
            amount: parseFloat(b.amount?.value ?? b.amount ?? 0) || 0,
          }));
        rows.unshift({
          id: 'wise-nextgenase',
          bank_name: 'Wise',
          account_nickname: 'Nextgenase Inc — Wise',
          account_type: 'Multi-currency',
          account_last4: null,
          entity_name: 'Nextgenase Inc',
          entity_id: null,
          status: 'active',
          current_balance: usdBalance,
          opening_balance: usdBalance,
          plaid_connected: false,
          plaid_synced_at: new Date().toISOString(),
          tx_count: 0,
          is_wise: true,
          sync_method: 'wise',
          extra_balances: extraBalances,
          all_balances: list, // raw, for the multi-currency grid
          created_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      // Wise unavailable — skip the synthetic row, keep returning the regular list.
      console.warn('[banks list] wise inclusion failed:', e.message);
    }

    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /api/banks ━━━
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(`
      INSERT INTO bank_accounts
        (entity_id, bank_name, account_nickname, account_last4, routing_reference, zelle_id,
         opening_balance, current_balance, status, notes)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::numeric,0),COALESCE($8::numeric,0),
              COALESCE($9,'active'),$10)
      RETURNING *
    `, [b.entity_id || null, b.bank_name || null, b.account_nickname || null,
        b.account_last4 || null, b.routing_reference || null, b.zelle_id || null,
        b.opening_balance, b.current_balance, b.status, b.notes || null]);

    await logAudit({
      action: 'bank.created', entityType: 'bank_accounts', entityId: r.rows[0].id,
      userId: req.user.id, metadata: { bank: b.bank_name, last4: b.account_last4 },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /api/banks/:id ━━━
router.get('/:id', async (req, res) => {
  try {
    const b = await pool.query(`
      SELECT b.*, e.legal_name AS entity_name,
             EXISTS(SELECT 1 FROM plaid_items pi WHERE pi.bank_account_id = b.id) AS plaid_connected,
             (SELECT institution_name FROM plaid_items pi WHERE pi.bank_account_id = b.id LIMIT 1) AS institution_name,
             (SELECT last_synced_at FROM plaid_items pi WHERE pi.bank_account_id = b.id LIMIT 1) AS last_synced_at
        FROM bank_accounts b
        LEFT JOIN entities e ON e.id = b.entity_id
       WHERE b.id = $1 AND b.is_deleted = false
    `, [req.params.id]);
    if (!b.rows.length) return res.status(404).json({ error: 'Not found' });

    const tx = await pool.query(`
      SELECT * FROM bank_transactions
       WHERE bank_account_id = $1 AND is_deleted = false
       ORDER BY posted_date DESC, id DESC LIMIT 50
    `, [req.params.id]);

    res.json({ bank: b.rows[0], transactions: tx.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ PUT /api/banks/:id ━━━
router.put('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['entity_id', 'bank_name', 'account_nickname', 'account_last4',
      'routing_reference', 'zelle_id', 'opening_balance', 'current_balance', 'status', 'notes'];
    const sets = [], params = [];
    for (const f of fields) {
      if (b[f] !== undefined) { params.push(b[f]); sets.push(`${f} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE bank_accounts SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} AND is_deleted = false RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });

    await logAudit({
      action: 'bank.updated', entityType: 'bank_accounts', entityId: req.params.id,
      userId: req.user.id, metadata: { fields: Object.keys(b) },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ DELETE /api/banks/:id ━━━
router.delete('/:id', async (req, res) => {
  if (!['super_admin', 'owner', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await pool.query(
      'UPDATE bank_accounts SET is_deleted = true, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    await logAudit({
      action: 'bank.deleted', entityType: 'bank_accounts', entityId: req.params.id,
      userId: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /api/banks/:id/transactions ━━━
router.get('/:id/transactions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const r = await pool.query(`
      SELECT * FROM bank_transactions
       WHERE bank_account_id = $1 AND is_deleted = false
       ORDER BY posted_date DESC, id DESC LIMIT $2 OFFSET $3
    `, [req.params.id, limit, offset]);
    const cnt = await pool.query(
      'SELECT COUNT(*)::int AS n FROM bank_transactions WHERE bank_account_id = $1 AND is_deleted = false',
      [req.params.id]
    );
    res.json({ rows: r.rows, total: cnt.rows[0].n, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /api/banks/:id/csv — import CSV statement ━━━
// Accepts: posted_date, description, amount, [merchant_name], [category]
router.post('/:id/csv', csvUpload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const text = req.file.buffer.toString('utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV has no data rows' });
    }
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
    const idx = (name) => header.indexOf(name);
    const dateIdx = idx('posted_date') >= 0 ? idx('posted_date') : (idx('date') >= 0 ? idx('date') : 0);
    const descIdx = idx('description') >= 0 ? idx('description') : 1;
    const amtIdx  = idx('amount') >= 0 ? idx('amount') : 2;
    const merchIdx = idx('merchant_name');
    const catIdx   = idx('category');

    function parseCsvRow(row) {
      const out = []; let cur = ''; let inQ = false;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    }

    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvRow(lines[i]);
      const date = row[dateIdx];
      const desc = row[descIdx];
      const amt = parseFloat((row[amtIdx] || '').replace(/[$,]/g, ''));
      if (!date || !isFinite(amt)) continue;
      await c.query(`
        INSERT INTO bank_transactions
          (bank_account_id, source, posted_date, description, merchant_name, category, amount, raw)
        VALUES ($1, 'csv', $2::date, $3, $4, $5, $6, $7::jsonb)
      `, [
        req.params.id, date, desc || null,
        merchIdx >= 0 ? row[merchIdx] : null,
        catIdx >= 0 ? row[catIdx] : null,
        amt, JSON.stringify({ raw_row: row.join(',') }),
      ]);
      imported++;
    }
    await c.query('COMMIT');

    await logAudit({
      action: 'bank.csv_imported', entityType: 'bank_accounts', entityId: req.params.id,
      userId: req.user.id, metadata: { imported, filename: req.file.originalname },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json({ ok: true, imported });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[banks csv]', err);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

// ━━━ Plaid: Create link token ━━━
router.post('/plaid/link-token', async (req, res) => {
  if (!plaid.isConfigured()) {
    return res.status(503).json({ error: 'Plaid not configured (PLAID_CLIENT_ID / PLAID_SECRET missing)' });
  }
  try {
    const r = await plaid.createLinkToken({ userId: req.user.id });
    res.json(r);
  } catch (err) {
    console.error('[plaid link-token]', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
});

// ━━━ Plaid: Exchange public_token + create bank_accounts + plaid_items ━━━
router.post('/plaid/exchange', async (req, res) => {
  if (!plaid.isConfigured()) {
    return res.status(503).json({ error: 'Plaid not configured' });
  }
  const c = await pool.connect();
  try {
    const { public_token, account_id, entity_id, account_nickname } = req.body || {};
    if (!public_token) return res.status(400).json({ error: 'public_token required' });

    const exch = await plaid.exchangePublicToken(public_token);
    const info = await plaid.getAccountInfo(exch.access_token);
    const targetAcct = account_id
      ? info.accounts.find((a) => a.account_id === account_id)
      : info.accounts[0];
    if (!targetAcct) return res.status(400).json({ error: 'No account selected' });

    let institutionName = null;
    if (info.item.institution_id) {
      try {
        const inst = await plaid.getInstitution(info.item.institution_id);
        institutionName = inst.name;
      } catch { /* ignore — sandbox sometimes returns 400 */ }
    }

    await c.query('BEGIN');
    const bank = await c.query(`
      INSERT INTO bank_accounts
        (entity_id, bank_name, account_nickname, account_last4,
         opening_balance, current_balance, status,
         plaid_linked, plaid_synced_at)
      VALUES ($1, $2, $3, $4, COALESCE($5::numeric,0), COALESCE($6::numeric,0), 'active',
              true, NOW())
      RETURNING *
    `, [
      entity_id || null,
      institutionName || targetAcct.name,
      account_nickname || `${institutionName || 'Bank'} ${targetAcct.subtype || ''}`.trim(),
      targetAcct.mask || null,
      targetAcct.balances?.current || 0,
      targetAcct.balances?.current || 0,
    ]);

    await c.query(`
      INSERT INTO plaid_items
        (bank_account_id, item_id, access_token, institution_id, institution_name,
         plaid_account_id, last_synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      bank.rows[0].id, exch.item_id, exch.access_token,
      info.item.institution_id, institutionName,
      targetAcct.account_id,
    ]);

    await c.query('COMMIT');

    await logAudit({
      action: 'bank.plaid_linked', entityType: 'bank_accounts', entityId: bank.rows[0].id,
      userId: req.user.id,
      metadata: { institution: institutionName, last4: targetAcct.mask, subtype: targetAcct.subtype },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.status(201).json({
      ok: true,
      bank: bank.rows[0],
      institution: institutionName,
      account_name: targetAcct.name,
    });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[plaid exchange]', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  } finally {
    c.release();
  }
});

// ━━━ Plaid: Sync transactions for a linked bank ━━━
router.post('/:id/plaid/sync', async (req, res) => {
  if (!plaid.isConfigured()) return res.status(503).json({ error: 'Plaid not configured' });
  const c = await pool.connect();
  try {
    const item = await c.query(
      'SELECT * FROM plaid_items WHERE bank_account_id = $1',
      [req.params.id]
    );
    if (!item.rows.length) return res.status(404).json({ error: 'Bank not linked to Plaid' });

    let cursor = item.rows[0].cursor;
    let allAdded = []; let allModified = []; let allRemoved = [];
    let hasMore = true;
    let safety = 0;
    while (hasMore && safety++ < 10) {
      const data = await plaid.syncTransactions(item.rows[0].access_token, cursor);
      allAdded = allAdded.concat(data.added);
      allModified = allModified.concat(data.modified);
      allRemoved = allRemoved.concat(data.removed);
      cursor = data.next_cursor;
      hasMore = data.has_more;
    }

    await c.query('BEGIN');
    let inserted = 0;
    for (const t of allAdded) {
      // Plaid amount: positive = outflow, negative = inflow. Flip sign so our column means inflow positive.
      const ourAmount = -parseFloat(t.amount);
      await c.query(`
        INSERT INTO bank_transactions
          (bank_account_id, source, external_id, posted_date, description, merchant_name, category, amount, pending, raw)
        VALUES ($1, 'plaid', $2, $3::date, $4, $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (bank_account_id, external_id) DO NOTHING
      `, [
        req.params.id, t.transaction_id,
        t.date, t.name || t.merchant_name,
        t.merchant_name || null,
        Array.isArray(t.category) ? t.category[0] : null,
        ourAmount, t.pending || false,
        JSON.stringify(t),
      ]);
      inserted++;
    }
    for (const t of allModified) {
      const ourAmount = -parseFloat(t.amount);
      await c.query(`
        UPDATE bank_transactions
           SET posted_date = $1::date, description = $2, merchant_name = $3,
               category = $4, amount = $5, pending = $6, raw = $7::jsonb
         WHERE bank_account_id = $8 AND external_id = $9
      `, [
        t.date, t.name || t.merchant_name, t.merchant_name || null,
        Array.isArray(t.category) ? t.category[0] : null,
        ourAmount, t.pending || false, JSON.stringify(t),
        req.params.id, t.transaction_id,
      ]);
    }
    for (const t of allRemoved) {
      await c.query(
        `UPDATE bank_transactions SET is_deleted = true
           WHERE bank_account_id = $1 AND external_id = $2`,
        [req.params.id, t.transaction_id]
      );
    }
    await c.query(
      `UPDATE plaid_items SET cursor = $1, last_synced_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [cursor, item.rows[0].id]
    );
    await c.query(
      `UPDATE bank_accounts SET plaid_synced_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    await c.query('COMMIT');

    res.json({ ok: true, added: inserted, modified: allModified.length, removed: allRemoved.length });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('[plaid sync]', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  } finally {
    c.release();
  }
});

// ━━━ Plaid: Refresh balance ━━━
router.post('/:id/plaid/refresh-balance', async (req, res) => {
  if (!plaid.isConfigured()) return res.status(503).json({ error: 'Plaid not configured' });
  try {
    const item = await pool.query(
      'SELECT access_token, plaid_account_id FROM plaid_items WHERE bank_account_id = $1',
      [req.params.id]
    );
    if (!item.rows.length) return res.status(404).json({ error: 'Bank not linked' });
    const data = await plaid.getBalances(item.rows[0].access_token);
    const acct = data.accounts.find((a) => a.account_id === item.rows[0].plaid_account_id) || data.accounts[0];
    const balance = parseFloat(acct?.balances?.current) || 0;
    await pool.query(
      `UPDATE bank_accounts SET current_balance = $1, plaid_synced_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [balance, req.params.id]
    );
    res.json({ ok: true, current_balance: balance });
  } catch (err) {
    console.error('[plaid balance]', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
});

module.exports = router;
