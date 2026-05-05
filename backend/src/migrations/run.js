require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[migrate] Running schema.sql...');
  try {
    await pool.query(sql);
    console.log('[migrate] ✅ Schema applied successfully');
  } catch (err) {
    console.error('[migrate] ❌ Schema failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
