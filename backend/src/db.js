const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'foundapay_erp',
  user: process.env.DB_USER || 'foundapay_user',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db pool error]', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
