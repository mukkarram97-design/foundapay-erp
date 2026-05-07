// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Wise (TransferWise) API client.
//
// Credential source order:
//   1. integration_credentials DB row (provider='wise') — entered via UI,
//      AES-256-GCM encrypted with APP_ENCRYPTION_KEY
//   2. WISE_API_TOKEN env var (legacy fallback)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const integrationCreds = require('./integrationCredentials');

// Cache decrypted token + metadata for 60s to avoid hitting the DB every call.
const TOKEN_TTL_MS = 60_000;
let _cache = { at: 0, token: null, profileId: null, env: null };

async function loadConfig() {
  const now = Date.now();
  if (_cache.at && now - _cache.at < TOKEN_TTL_MS) return _cache;

  // Prefer DB-encrypted credentials.
  let token = null, profileId = null, env = null;
  try {
    const dbToken = await integrationCreds.getDecryptedToken('wise');
    const status = await integrationCreds.getStatus('wise');
    if (dbToken) {
      token = dbToken;
      profileId = status?.metadata?.profile_id || process.env.WISE_PROFILE_ID || null;
      env = status?.metadata?.environment || process.env.WISE_ENV || 'sandbox';
    }
  } catch (e) {
    // DB unreachable / decrypt failed → fall back to env.
    console.warn('[wise] DB credential read failed, falling back to env:', e.message);
  }

  if (!token) {
    token = process.env.WISE_API_TOKEN || null;
    profileId = process.env.WISE_PROFILE_ID || null;
    env = process.env.WISE_ENV || 'sandbox';
  }

  _cache = { at: now, token, profileId, env: String(env || 'sandbox').toLowerCase() };
  return _cache;
}

// Force a refresh — call after the UI saves new credentials.
function invalidateCache() { _cache = { at: 0, token: null, profileId: null, env: null }; }

// Quick configured check — used by routes that gate behind isConfigured().
// Synchronous fallback to env so we don't break existing call patterns; full
// async refresh happens inside request().
function isConfigured() {
  if (_cache.at && Date.now() - _cache.at < TOKEN_TTL_MS) {
    return !!(_cache.token && _cache.profileId);
  }
  return !!(process.env.WISE_API_TOKEN && process.env.WISE_PROFILE_ID);
}

function baseUrlFor(env) {
  return (env === 'live') ? 'https://api.transferwise.com' : 'https://api.sandbox.transferwise.tech';
}

async function request(method, path, body) {
  const cfg = await loadConfig();
  if (!cfg.token || !cfg.profileId) {
    throw new Error('Wise not configured. Add credentials at /settings (Integrations → Wise).');
  }
  const r = await fetch(`${baseUrlFor(cfg.env)}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = (data && data.errors && data.errors[0]?.message) || (data && data.message) || `HTTP ${r.status}`;
    const e = new Error(msg);
    e.status = r.status;
    e.body = data;
    throw e;
  }
  return data;
}

// ━━━ Public wrappers ━━━

async function getBalances() {
  const cfg = await loadConfig();
  return request('GET', `/v4/profiles/${cfg.profileId}/balances?types=STANDARD`);
}

async function createQuote({ sourceCurrency, targetCurrency, sourceAmount, targetAmount }) {
  const cfg = await loadConfig();
  const body = {
    sourceCurrency, targetCurrency,
    payOut: 'BANK_TRANSFER',
  };
  if (sourceAmount) body.sourceAmount = parseFloat(sourceAmount);
  if (targetAmount) body.targetAmount = parseFloat(targetAmount);
  return request('POST', `/v3/profiles/${cfg.profileId}/quotes`, body);
}

async function listRecipients(currency) {
  const cfg = await loadConfig();
  const q = currency ? `?currency=${currency}` : '';
  return request('GET', `/v1/accounts${q}&profile=${cfg.profileId}`.replace('?&', '?'));
}

async function createRecipient(body) {
  const cfg = await loadConfig();
  return request('POST', `/v1/accounts`, { ...body, profile: parseInt(cfg.profileId, 10) });
}

async function createTransfer({ targetAccount, quoteUuid, customerTransactionId, reference, sourceOfFunds }) {
  return request('POST', `/v1/transfers`, {
    targetAccount,
    quoteUuid,
    customerTransactionId,
    details: { reference, sourceOfFunds: sourceOfFunds || 'verification.source.of.funds.other' },
  });
}

async function fundTransfer(transferId) {
  const cfg = await loadConfig();
  return request('POST', `/v3/profiles/${cfg.profileId}/transfers/${transferId}/payments`, { type: 'BALANCE' });
}

async function getTransfer(transferId) {
  return request('GET', `/v1/transfers/${transferId}`);
}

async function getReceipt(transferId) {
  const cfg = await loadConfig();
  return `${baseUrlFor(cfg.env)}/v1/transfers/${transferId}/receipt.pdf`;
}

// Fetch the Wise PDF receipt as a binary stream we can pipe through to the
// frontend. Returns { buffer, contentType } or throws.
async function getReceiptPdf(transferId) {
  const cfg = await loadConfig();
  if (!cfg.token) throw new Error('Wise not configured');
  const r = await fetch(`${baseUrlFor(cfg.env)}/v3/profiles/${cfg.profileId}/transfers/${transferId}/receipt.pdf`, {
    headers: { 'Authorization': `Bearer ${cfg.token}`, 'Accept': 'application/pdf' },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const e = new Error(`Wise receipt fetch failed: HTTP ${r.status} ${body.slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  const arrayBuffer = await r.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: r.headers.get('content-type') || 'application/pdf' };
}

// /v1/transfers/:id/payments returns the payment timeline + tracking link.
// Wise's response shape varies by transfer state — return raw and let the
// route layer extract trackingUrl + events.
async function getPayments(transferId) {
  return request('GET', `/v1/transfers/${transferId}/payments`);
}

module.exports = {
  isConfigured,
  invalidateCache,
  loadConfig,
  getBalances,
  createQuote,
  listRecipients,
  createRecipient,
  createTransfer,
  fundTransfer,
  getTransfer,
  getPayments,
  getReceipt,
  getReceiptPdf,
};
