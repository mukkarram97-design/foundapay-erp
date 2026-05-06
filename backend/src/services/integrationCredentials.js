// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Read/write helpers for integration_credentials.
//
// Public API:
//   getStatus(provider)         → { configured, metadata, lastTest }
//   getDecryptedToken(provider) → string | null  (server-only, never returned to clients)
//   setCredentials(provider, { token, metadata, userId })
//   recordTest(provider, { ok, message })
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { pool } = require('../db');
const { encrypt, decrypt } = require('./crypto');

async function getStatus(provider) {
  const r = await pool.query(
    `SELECT provider, encrypted_payload IS NOT NULL AS configured,
            metadata, configured_at, last_tested_at, last_test_status, last_test_message
       FROM integration_credentials WHERE provider = $1`,
    [provider]
  );
  if (!r.rows.length) {
    return { configured: false, metadata: {}, lastTest: null, configuredAt: null };
  }
  const row = r.rows[0];
  return {
    configured: row.configured,
    metadata: row.metadata || {},
    configuredAt: row.configured_at,
    lastTest: row.last_tested_at ? {
      at: row.last_tested_at,
      status: row.last_test_status,
      message: row.last_test_message,
    } : null,
  };
}

async function getDecryptedToken(provider) {
  const r = await pool.query(
    `SELECT encrypted_payload FROM integration_credentials WHERE provider = $1`,
    [provider]
  );
  if (!r.rows.length || !r.rows[0].encrypted_payload) return null;
  try {
    return decrypt(r.rows[0].encrypted_payload);
  } catch (e) {
    // Wrong key, corrupt payload, etc. Don't crash callers — surface as "not configured".
    console.warn(`[integrationCredentials] decrypt failed for ${provider}: ${e.message}`);
    return null;
  }
}

async function setCredentials(provider, { token, metadata, userId }) {
  // If token === undefined we're updating metadata only; if token === '' we're clearing it.
  const update = {};
  if (token !== undefined) {
    update.encrypted_payload = token === '' ? null : encrypt(token);
  }
  if (metadata !== undefined) {
    update.metadata = metadata || {};
  }

  const exists = await pool.query(
    `SELECT 1 FROM integration_credentials WHERE provider = $1`,
    [provider]
  );

  if (exists.rows.length) {
    const sets = ['updated_at = NOW()', 'configured_at = NOW()', 'configured_by = $1'];
    const params = [userId];
    if (update.encrypted_payload !== undefined) {
      params.push(update.encrypted_payload === null ? null : JSON.stringify(update.encrypted_payload));
      sets.push(`encrypted_payload = $${params.length}::jsonb`);
    }
    if (update.metadata !== undefined) {
      params.push(JSON.stringify(update.metadata));
      sets.push(`metadata = $${params.length}::jsonb`);
    }
    params.push(provider);
    await pool.query(
      `UPDATE integration_credentials SET ${sets.join(', ')} WHERE provider = $${params.length}`,
      params
    );
  } else {
    await pool.query(
      `INSERT INTO integration_credentials
         (provider, encrypted_payload, metadata, configured_at, configured_by)
       VALUES ($1, $2::jsonb, $3::jsonb, NOW(), $4)`,
      [
        provider,
        update.encrypted_payload === null ? null : JSON.stringify(update.encrypted_payload || null),
        JSON.stringify(update.metadata || {}),
        userId,
      ]
    );
  }
}

async function recordTest(provider, { ok, message }) {
  await pool.query(
    `UPDATE integration_credentials
        SET last_tested_at = NOW(), last_test_status = $1, last_test_message = $2, updated_at = NOW()
      WHERE provider = $3`,
    [ok ? 'ok' : 'error', message ? String(message).slice(0, 500) : null, provider]
  );
}

module.exports = { getStatus, getDecryptedToken, setCredentials, recordTest };
