// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Per-processor health-check implementations.
//
// All implementations return:
//   { status: 'healthy'|'slow'|'error'|'unconfigured', latency: ms, message: string }
//
// 'authnet' uses the existing service which signs an authenticateTestRequest.
// Other processors do a lightweight authenticated GET to verify creds.
// 'manual' returns 'unconfigured' (no API to test).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const authNet = require('./authorizeNet');

// Stripe: GET /v1/balance with `Authorization: Bearer <secret_key>`.
async function checkStripe(creds) {
  const sk = creds?.secret_key;
  if (!sk) return { status: 'unconfigured', message: 'Add Stripe Secret Key to activate' };
  const start = Date.now();
  try {
    const r = await fetch('https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${sk}` },
    });
    const latency = Date.now() - start;
    if (r.ok) {
      return { status: latency > 2000 ? 'slow' : 'healthy', latency, message: `Connected (${latency}ms)` };
    }
    const body = await r.text();
    return { status: 'error', latency, message: `HTTP ${r.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    return { status: 'error', latency: Date.now() - start, message: e.message };
  }
}

// Square: GET /v2/locations with `Authorization: Bearer <access_token>`.
// Live vs sandbox decided by base URL.
async function checkSquare(creds, isSandbox) {
  const at = creds?.access_token;
  if (!at) return { status: 'unconfigured', message: 'Add Square Access Token to activate' };
  const base = isSandbox ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const start = Date.now();
  try {
    const r = await fetch(`${base}/v2/locations`, {
      headers: { 'Authorization': `Bearer ${at}`, 'Square-Version': '2024-01-18' },
    });
    const latency = Date.now() - start;
    if (r.ok) return { status: latency > 2000 ? 'slow' : 'healthy', latency, message: `Connected (${latency}ms)` };
    const body = await r.text();
    return { status: 'error', latency, message: `HTTP ${r.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    return { status: 'error', latency: Date.now() - start, message: e.message };
  }
}

// PayPal: OAuth2 token endpoint. Live vs sandbox decided by base URL.
async function checkPaypal(creds, isSandbox) {
  const cid = creds?.client_id;
  const cs  = creds?.client_secret;
  if (!cid || !cs) return { status: 'unconfigured', message: 'Add PayPal Client ID + Secret to activate' };
  const base = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const start = Date.now();
  try {
    const auth = Buffer.from(`${cid}:${cs}`).toString('base64');
    const r = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const latency = Date.now() - start;
    if (r.ok) return { status: latency > 2000 ? 'slow' : 'healthy', latency, message: `Connected (${latency}ms)` };
    const body = await r.text();
    return { status: 'error', latency, message: `HTTP ${r.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    return { status: 'error', latency: Date.now() - start, message: e.message };
  }
}

// NMI / PaymentCloud — both speak the legacy NMI Direct Post Query API.
// Stub: return 'unconfigured' until creds are provided. We don't ship a
// blanket-test as the API requires a posted query that a misconfigured
// account would fail in misleading ways.
async function checkNmi(creds) {
  if (!creds?.username || !creds?.password) {
    return { status: 'unconfigured', message: 'Add NMI username + password to activate' };
  }
  return { status: 'unknown', message: 'NMI live test not yet implemented — credentials stored.' };
}
async function checkPaymentCloud(creds) {
  if (!creds?.api_key) {
    return { status: 'unconfigured', message: 'Add PaymentCloud API Key to activate' };
  }
  return { status: 'unknown', message: 'PaymentCloud live test not yet implemented — credentials stored.' };
}

// Authorize.net — reads creds from per-merchant api_credentials JSONB so each
// authnet merchant can be tested independently. Falls back to .env values
// (AUTHNET_LOGIN_ID / AUTHNET_TRANSACTION_KEY / AUTHNET_SANDBOX) when the
// merchant row doesn't carry creds yet — keeps legacy single-merchant setups
// working until they're migrated.
async function checkAuthnet(creds, isSandbox) {
  const loginId        = creds?.loginId        || process.env.AUTHNET_LOGIN_ID;
  const transactionKey = creds?.transactionKey || process.env.AUTHNET_TRANSACTION_KEY;
  const sandbox        = creds?.sandbox != null ? !!creds.sandbox : (isSandbox ?? (process.env.AUTHNET_SANDBOX === 'true'));

  if (!loginId || !transactionKey) {
    return { status: 'unconfigured', message: 'Add Authorize.net loginId + transactionKey to activate' };
  }

  const start = Date.now();
  try {
    const r = await authNet.testConnectionWithCreds({ loginId, transactionKey, sandbox });
    const latency = Date.now() - start;
    if (r.success) {
      return { status: latency > 2000 ? 'slow' : 'healthy', latency, message: r.message || `Connected (${latency}ms)` };
    }
    return { status: 'error', latency, message: r.message || 'Authentication failed' };
  } catch (e) {
    return { status: 'error', latency: Date.now() - start, message: e.message };
  }
}

async function runHealthCheck(processorType, creds, { isSandbox = false } = {}) {
  const t = String(processorType || '').toLowerCase();
  switch (t) {
    case 'authnet':       return checkAuthnet(creds, isSandbox);
    case 'stripe':        return checkStripe(creds);
    case 'square':        return checkSquare(creds, isSandbox);
    case 'paypal':        return checkPaypal(creds, isSandbox);
    case 'nmi':           return checkNmi(creds);
    case 'paymentcloud':  return checkPaymentCloud(creds);
    case 'manual':        return { status: 'unconfigured', message: 'Manual merchant — no API to test' };
    default:              return { status: 'unconfigured', message: `Unknown processor type: ${processorType}` };
  }
}

module.exports = { runHealthCheck };
