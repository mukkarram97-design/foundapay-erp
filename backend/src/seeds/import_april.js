/**
 * One-shot import: 436 April 2026 transactions from
 * /Users/syedmukkarram/Downloads/foundapay/backend/transactions_seed.json
 *
 * - Truncates existing transactions + reserves first
 * - Preserves source row IDs
 * - Resolves client_id / entity_id / merchant_id by name (with normalization)
 * - Auto-fills net_amount when source has NULL using source fee%
 * - Auto-creates reserve rows for DND / Azeem / Husk SOL transactions
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const SOURCE = '/Users/syedmukkarram/Downloads/foundapay/backend/transactions_seed.json';

// Normalize source entity names → canonical legal_name
const ENTITY_NORM = {
  'Hashai': 'Hashai Corp',
  'Hashai ': 'Hashai Corp',
  'Hashai corp': 'Hashai Corp',
  'Plus Flow Digital Inc': 'PlusFlow Digital Inc',
  'Research Sphere Inc': 'Research-sphere Inc',
  'Sanf Inc': 'SANF Inc',
  'Mindmesh Innovation Inc': 'Mind Mesh Innovations Inc',
};
const normEntity = (n) => {
  if (!n) return null;
  const t = String(n).trim();
  return ENTITY_NORM[t] || ENTITY_NORM[n] || t;
};

// Reserve rules (mirrors transactionEngine.js)
const RESERVE_RULES = {
  'DND':      { pct: 0.10, basis: 'gross',          label: '10% of Gross' },
  'Azeem':    { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross - Merchant Charges)' },
  'Husk SOL': { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross - Merchant Charges)' },
};

// merchant_account values that map to a real processor row in `merchants` table
// (vs bank names like Mercury/Chase/BOA/Wise which we leave as merchant_id NULL but keep the string)
const PROCESSOR_NAMES = new Set(['Payment Cloud', 'Authorize.net', 'PayPal', 'Paypal', 'Stripe Online', 'Elavon']);

async function run() {
  const c = await pool.connect();
  try {
    console.log('[import] Reading', SOURCE);
    let raw = fs.readFileSync(SOURCE, 'utf8');
    // Python json sometimes writes literal NaN/Infinity — coerce to null
    raw = raw.replace(/:\s*NaN/g, ': null')
             .replace(/:\s*-?Infinity/g, ': null');
    const arr = JSON.parse(raw);
    console.log('[import] Source has', arr.length, 'rows');

    // Build lookup tables
    const clients = (await c.query('SELECT id, name FROM clients')).rows;
    const clientByLowerName = {};
    for (const r of clients) clientByLowerName[r.name.toLowerCase()] = r.id;

    const entities = (await c.query('SELECT id, legal_name FROM entities')).rows;
    const entityByName = {};
    for (const r of entities) entityByName[r.legal_name] = r.id;

    const merchants = (await c.query('SELECT id, processor_name, entity_id FROM merchants')).rows;
    const merchantByPair = {};
    for (const r of merchants) merchantByPair[`${r.processor_name}|${r.entity_id}`] = r.id;

    const adminId = (await c.query("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1")).rows[0].id;

    await c.query('BEGIN');

    console.log('[import] Truncating transactions and reserves...');
    await c.query('TRUNCATE reserves CASCADE');
    await c.query('TRUNCATE transactions RESTART IDENTITY CASCADE');

    let inserted = 0, reservesCreated = 0;
    const unmatched = { clients: new Set(), entities: new Set(), merchants: new Set() };
    const skipped = [];

    for (const t of arr) {
      // resolve client
      let clientId = null;
      if (t.counterparty_name && t.counterparty_type === 'Client') {
        clientId = clientByLowerName[t.counterparty_name.toLowerCase()] || null;
        if (!clientId) unmatched.clients.add(t.counterparty_name);
      }

      // resolve entity
      const entityName = normEntity(t.company_name);
      const entityId = entityName ? (entityByName[entityName] || null) : null;
      if (entityName && !entityId) unmatched.entities.add(`${t.company_name} -> ${entityName}`);

      // resolve merchant only for processor rows
      let merchantId = null;
      if (t.merchant_account && entityId && PROCESSOR_NAMES.has(t.merchant_account)) {
        const key = `${t.merchant_account}|${entityId}`;
        merchantId = merchantByPair[key] || null;
        if (!merchantId) unmatched.merchants.add(`${t.merchant_account} @ ${entityName}`);
      }

      // compute net_amount if NULL — use source's fee + merchant_charges
      let netAmount = t.net_amount;
      const gross = parseFloat(t.gross_amount) || 0;
      const fee = parseFloat(t.fee_amount) || 0;
      const mc = parseFloat(t.merchant_charges) || 0;
      if (netAmount == null) {
        if (t.type === 'Paid') netAmount = -gross;
        else                   netAmount = gross - fee - mc;
      }

      // reserve calculation (don't store on transaction; we'll insert a reserves row)
      const reserveRule = clientId && t.counterparty_name ? RESERVE_RULES[t.counterparty_name] : null;
      let reservePct = 0, reserveAmount = 0;
      if (reserveRule && t.type === 'Received') {
        reservePct = reserveRule.pct;
        const base = reserveRule.basis === 'gross' ? gross : Math.max(0, gross - mc);
        reserveAmount = +(base * reserveRule.pct).toFixed(4);
      }

      // skip rows without a date_received (data quality)
      const date = t.date_received && /^\d{4}-\d{2}-\d{2}/.test(String(t.date_received)) ? t.date_received : null;
      if (!date) { skipped.push(`row id=${t.id}: bad date_received=${t.date_received}`); continue; }

      try {
        await c.query(`
          INSERT INTO transactions
            (id, type, date_received, client_id, counterparty_type, counterparty_name,
             entity_id, merchant_id, payment_method, sending_method, company_name, merchant_account,
             gross_amount, foundapay_fee_pct, fee_amount, merchant_charges, bearing_merchant_charges,
             net_amount, funds_available_date, reserve_pct, reserve_amount, reserve_bearer,
             status, notes, created_by)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Client',$17,$18,$19,$20,'Client',$21,$22,$23)
        `, [
          t.id, t.type, date, clientId, t.counterparty_type || null, t.counterparty_name || null,
          entityId, merchantId, t.payment_method || null, t.sending_method || null, t.company_name || null, t.merchant_account || null,
          gross, t.foundapay_fee_pct || 0, fee, mc,
          netAmount, t.funds_available_date || date, reservePct, reserveAmount,
          t.status || 'Completed', t.notes || null, adminId,
        ]);
        inserted++;

        if (reserveAmount > 0) {
          await c.query(`
            INSERT INTO reserves (transaction_id, client_id, merchant_id, amount, bearer, reserve_type, hold_date, status)
            VALUES ($1,$2,$3,$4,'Client',$5,$6,'held')
          `, [t.id, clientId, merchantId, reserveAmount, reserveRule.label, date]);
          reservesCreated++;
        }
      } catch (err) {
        skipped.push(`row id=${t.id}: ${err.message}`);
      }
    }

    // Bump SERIAL sequence past max id
    await c.query(`SELECT setval(pg_get_serial_sequence('transactions','id'), (SELECT MAX(id) FROM transactions))`);

    // Update client.balance_owed and total_received from received transactions
    console.log('[import] Recomputing client balances...');
    await c.query(`
      UPDATE clients c SET
        total_received = COALESCE(s.gross, 0),
        our_revenue = COALESCE(s.fees, 0)
      FROM (
        SELECT client_id, SUM(gross_amount) AS gross, SUM(fee_amount) AS fees
          FROM transactions WHERE type = 'Received' AND client_id IS NOT NULL GROUP BY client_id
      ) s
      WHERE c.id = s.client_id
    `);

    // Compute balance_owed = received_net (gross-commission-charges) - paid_to_client
    await c.query(`
      UPDATE clients c SET balance_owed = COALESCE(s.bal, 0)
      FROM (
        SELECT client_id,
               SUM(CASE WHEN type='Received' THEN net_amount ELSE 0 END) -
               SUM(CASE WHEN type='Paid'     THEN gross_amount ELSE 0 END) AS bal
          FROM transactions WHERE client_id IS NOT NULL GROUP BY client_id
      ) s
      WHERE c.id = s.client_id
    `);

    await c.query('COMMIT');

    console.log('');
    console.log(`[import] ✅ Inserted ${inserted} transactions, ${reservesCreated} reserves`);
    console.log('');
    if (skipped.length) {
      console.log(`[import] Skipped ${skipped.length}:`);
      for (const s of skipped.slice(0, 10)) console.log('   ', s);
    }
    if (unmatched.clients.size) console.log(`[import] Unmatched client names (${unmatched.clients.size}):`, [...unmatched.clients]);
    if (unmatched.entities.size) console.log(`[import] Unmatched entities (${unmatched.entities.size}):`, [...unmatched.entities]);
    if (unmatched.merchants.size) console.log(`[import] Unmatched processor merchants (${unmatched.merchants.size}):`, [...unmatched.merchants]);

    // Final totals
    const totals = await c.query(`
      SELECT
        COUNT(*)::int                                                                AS count,
        COUNT(*) FILTER (WHERE type='Received')::int                                 AS received_count,
        COUNT(*) FILTER (WHERE type='Paid')::int                                     AS paid_count,
        COALESCE(SUM(gross_amount) FILTER (WHERE type='Received'), 0)::numeric(15,2) AS gross_received,
        COALESCE(SUM(fee_amount)   FILTER (WHERE type='Received'), 0)::numeric(15,2) AS revenue,
        COALESCE(SUM(gross_amount) FILTER (WHERE type='Paid'), 0)::numeric(15,2)     AS paid_out
      FROM transactions
    `);
    console.log('');
    console.log('Final DB totals:');
    console.log(`  Total transactions: ${totals.rows[0].count}`);
    console.log(`  Received:           ${totals.rows[0].received_count}  gross=$${totals.rows[0].gross_received}`);
    console.log(`  Revenue:            $${totals.rows[0].revenue}`);
    console.log(`  Paid:               ${totals.rows[0].paid_count}  gross=$${totals.rows[0].paid_out}`);
    console.log('');
    console.log('Reconciled truth (Apr 2026): gross=$285,497.51  revenue=$36,835.62  paid_out=$184,331.54');
  } catch (err) {
    await c.query('ROLLBACK');
    console.error('[import] ❌', err);
    throw err;
  } finally {
    c.release();
  }
}

(async () => {
  try { await run(); }
  catch { process.exit(1); }
  finally { await pool.end(); }
})();
