// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Wise (TransferWise) API client.
//
// Env:
//   WISE_API_TOKEN   — bearer token
//   WISE_PROFILE_ID  — business profile ID
//   WISE_ENV         — 'sandbox' | 'live'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isConfigured() {
  return !!(process.env.WISE_API_TOKEN && process.env.WISE_PROFILE_ID);
}

function baseUrl() {
  const env = (process.env.WISE_ENV || 'sandbox').toLowerCase();
  return env === 'live' ? 'https://api.transferwise.com' : 'https://api.sandbox.transferwise.tech';
}

function profileId() {
  return process.env.WISE_PROFILE_ID;
}

async function request(method, path, body) {
  if (!isConfigured()) throw new Error('Wise not configured (WISE_API_TOKEN / WISE_PROFILE_ID missing)');
  const r = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.WISE_API_TOKEN}`,
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
  // Multi-currency account → list balances. v4 API:
  return request('GET', `/v4/profiles/${profileId()}/balances?types=STANDARD`);
}

async function createQuote({ sourceCurrency, targetCurrency, sourceAmount, targetAmount }) {
  const body = {
    sourceCurrency, targetCurrency,
    payOut: 'BANK_TRANSFER',
  };
  if (sourceAmount) body.sourceAmount = parseFloat(sourceAmount);
  if (targetAmount) body.targetAmount = parseFloat(targetAmount);
  return request('POST', `/v3/profiles/${profileId()}/quotes`, body);
}

async function listRecipients(currency) {
  const q = currency ? `?currency=${currency}` : '';
  return request('GET', `/v1/accounts${q}&profile=${profileId()}`.replace('?&', '?'));
}

async function createRecipient(body) {
  return request('POST', `/v1/accounts`, { ...body, profile: parseInt(profileId(), 10) });
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
  return request('POST', `/v3/profiles/${profileId()}/transfers/${transferId}/payments`, { type: 'BALANCE' });
}

async function getTransfer(transferId) {
  return request('GET', `/v1/transfers/${transferId}`);
}

async function getReceipt(transferId) {
  // Wise returns a PDF binary; for our UI we just point at the URL.
  return `${baseUrl()}/v1/transfers/${transferId}/receipt.pdf`;
}

module.exports = {
  isConfigured,
  getBalances,
  createQuote,
  listRecipients,
  createRecipient,
  createTransfer,
  fundTransfer,
  getTransfer,
  getReceipt,
};
