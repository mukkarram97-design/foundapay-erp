require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const bcrypt = require('bcryptjs');
const { pool } = require('../db');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXAMPLE seed file — safe to commit. Uses placeholder data only.
// Real data lives in seeds/run.js (gitignored).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CLIENTS = [
  { name: 'Demo Client A', card: 0.10, wire: 0.05, cheque: 0, ach: 0, zelle: 0.10, terms: '', opening: 0, apr_balance: 0 },
  { name: 'Demo Client B', card: 0.15, wire: 0,    cheque: 0, ach: 0, zelle: 0,    terms: '', opening: 0, apr_balance: 0 },
];

const ENTITIES = [
  { legal_name: 'Demo Entity One Inc', owner: 'Demo Owner' },
  { legal_name: 'Demo Entity Two Inc', owner: 'Demo Owner' },
];

const BANK_ACCOUNTS = [
  { entity: 'Demo Entity One Inc', bank: 'Mercury', opening: 100, current: 100 },
];

const CARDS = [
  { entity: 'Demo Entity One Inc', bank: 'Mercury', holder: 'Demo Holder', nick: 'Demo Card', last4: '0000', exp: '12/30', type: 'virtual' },
];

const SALARY = {
  period: 'Demo Month 2026',
  pay_date: '2026-01-31',
  exchange_rate: 280,
  total_usd: 500,
  total_pkr: 140000,
  items: [
    { name: 'Demo Employee', full: 'Demo Employee Full', bank: 'Demo Bank', account: 'PK00DEMO0000000000000000', usd: 500, pkr: 140000 },
  ],
};

const COA = [
  { code: '1000', name: 'Cash & Bank', type: 'asset' },
  { code: '4000', name: 'Revenue',     type: 'income' },
  { code: '5000', name: 'Expenses',    type: 'expense' },
];

const CMS_DEFAULTS = [
  { key: 'expense_categories', value: ['SaaS','Bank Fees','Salaries'] },
  { key: 'payout_methods',     value: ['Bank Wire','ACH','Zelle'] },
  { key: 'fx_rate_pkr',        value: 280 },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      TRUNCATE TABLE
        salary_items, salary_disbursements,
        cards, bank_accounts,
        client_visibility_settings,
        chart_of_accounts, cms_settings
      RESTART IDENTITY CASCADE
    `);
    await client.query(`DELETE FROM clients`);
    await client.query(`DELETE FROM entities`);
    await client.query(`DELETE FROM users`);

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPass = process.env.ADMIN_PASSWORD || 'StrongAdmin@123';
    const adminHash = await bcrypt.hash(adminPass, 10);
    await client.query(
      `INSERT INTO users (email, password_hash, name, role, is_active)
       VALUES ($1,$2,'Demo Admin','super_admin',true)`,
      [adminEmail, adminHash]
    );

    const entityIdByName = {};
    for (const e of ENTITIES) {
      const r = await client.query(
        `INSERT INTO entities (legal_name, owner_name, ein_reference, status, entity_type)
         VALUES ($1,$2,$3,'active','LLC') RETURNING id`,
        [e.legal_name, e.owner, `EIN_DOC_REF_${e.legal_name.replace(/\s+/g,'_')}`]
      );
      entityIdByName[e.legal_name] = r.rows[0].id;
    }

    for (const c of CLIENTS) {
      const r = await client.query(
        `INSERT INTO clients
           (name, card_pct, wire_pct, cheque_pct, ach_pct, zelle_pct,
            other_terms, opening_balance, balance_owed, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
        [c.name, c.card, c.wire, c.cheque, c.ach, c.zelle, c.terms, c.opening, c.apr_balance]
      );
      await client.query(`INSERT INTO client_visibility_settings (client_id) VALUES ($1)`, [r.rows[0].id]);
    }

    for (const b of BANK_ACCOUNTS) {
      await client.query(
        `INSERT INTO bank_accounts
           (entity_id, bank_name, account_nickname, opening_balance, current_balance, status)
         VALUES ($1,$2,$3,$4,$5,'active')`,
        [entityIdByName[b.entity], b.bank, `${b.entity} – ${b.bank}`, b.opening, b.current]
      );
    }

    for (const c of CARDS) {
      await client.query(
        `INSERT INTO cards
           (nickname, last4, card_type, bank_name, entity_id, cardholder_name, expiry, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
        [c.nick, c.last4, c.type, c.bank, entityIdByName[c.entity], c.holder, c.exp]
      );
    }

    const sd = await client.query(
      `INSERT INTO salary_disbursements (period, pay_date, exchange_rate, total_usd, total_pkr, status)
       VALUES ($1,$2,$3,$4,$5,'draft') RETURNING id`,
      [SALARY.period, SALARY.pay_date, SALARY.exchange_rate, SALARY.total_usd, SALARY.total_pkr]
    );
    for (const it of SALARY.items) {
      await client.query(
        `INSERT INTO salary_items
           (disbursement_id, employee_name, full_name, bank_name, account_number, amount_usd, amount_pkr, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
        [sd.rows[0].id, it.name, it.full, it.bank, it.account, it.usd, it.pkr]
      );
    }

    for (const a of COA) {
      await client.query(
        `INSERT INTO chart_of_accounts (code, name, type, is_active)
         VALUES ($1,$2,$3,true)`,
        [a.code, a.name, a.type]
      );
    }

    for (const s of CMS_DEFAULTS) {
      await client.query(
        `INSERT INTO cms_settings (key, value) VALUES ($1, $2)`,
        [s.key, JSON.stringify(s.value)]
      );
    }

    await client.query('COMMIT');
    console.log('[seed:example] ✅ Demo data inserted');
    console.log(`  Admin login: ${adminEmail} / ${adminPass}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed:example] ❌', err);
    throw err;
  } finally {
    client.release();
  }
}

(async () => {
  try { await seed(); }
  catch (e) { process.exit(1); }
  finally { await pool.end(); }
})();
