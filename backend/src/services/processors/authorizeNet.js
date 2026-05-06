// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Authorize.net — Designory Inc
//
// Two charge surfaces:
//   1. chargeCard()                — accepts raw PAN. PCI SAQ-D scope.
//                                    Use only behind a hosted-fields swap or
//                                    until you've signed the SAQ-D commitment.
//   2. generateHostedPaymentLink() — returns a hosted-page URL + token.
//                                    Card never touches our server. SAQ-A.
//
// + voidTransaction, refundTransaction, getTransactionDetails,
//   testConnection, verifySignature (for Authorize.net webhooks).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const axios = require('axios');
const crypto = require('crypto');

const ENDPOINT = process.env.AUTHNET_SANDBOX === 'true'
  ? 'https://apitest.authorize.net/xml/v1/request.api'
  : 'https://api.authorize.net/xml/v1/request.api';

const HOSTED_BASE = process.env.AUTHNET_SANDBOX === 'true'
  ? 'https://test.authorize.net/payment/payment'
  : 'https://accept.authorize.net/payment/payment';

function getAuth() {
  return {
    name: process.env.AUTHNET_LOGIN_ID,
    transactionKey: process.env.AUTHNET_TRANSACTION_KEY,
  };
}

function isConfigured() {
  return !!(process.env.AUTHNET_LOGIN_ID && process.env.AUTHNET_TRANSACTION_KEY);
}

// Authorize.net responses are sometimes BOM-prefixed JSON
function parseAuthnetResponse(raw) {
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw).replace(/^﻿/, '')); }
  catch { return raw; }
}

async function authnetPost(payload) {
  const res = await axios.post(ENDPOINT, payload, {
    headers: { 'Content-Type': 'application/json' },
    transformResponse: [(d) => d], // get raw text so we can strip BOM
    timeout: 30000,
  });
  return parseAuthnetResponse(res.data);
}

// ━━━ 1. DIRECT CARD CHARGE (authCapture) ─────────────────
async function chargeCard(params) {
  if (!isConfigured()) {
    return { success: false, message: 'Authorize.net credentials not configured' };
  }
  const {
    amount, cardNumber, expirationDate, cardCode,
    firstName, lastName, email, phone,
    description, invoiceNumber, address, city, zip, country,
  } = params;

  const payload = {
    createTransactionRequest: {
      merchantAuthentication: getAuth(),
      refId: (invoiceNumber || `FP-${Date.now()}`).slice(0, 20),
      transactionRequest: {
        transactionType: 'authCaptureTransaction',
        amount: parseFloat(amount).toFixed(2),
        payment: {
          creditCard: {
            cardNumber: String(cardNumber).replace(/[\s-]/g, ''),
            expirationDate,
            cardCode: String(cardCode),
          },
        },
        order: {
          invoiceNumber: (invoiceNumber || `INV-${Date.now()}`).slice(0, 20),
          description: (description || 'FoundaPay Payment').slice(0, 255),
        },
        lineItems: {
          lineItem: {
            itemId: '1',
            name: (description || 'Payment').slice(0, 31),
            quantity: '1',
            unitPrice: parseFloat(amount).toFixed(2),
          },
        },
        customer: { email: email || '' },
        billTo: {
          firstName: (firstName || '').slice(0, 50),
          lastName: (lastName || '').slice(0, 50),
          address: (address || '').slice(0, 60),
          city: (city || '').slice(0, 40),
          zip: (zip || '').slice(0, 20),
          country: country || 'US',
          phoneNumber: (phone || '').slice(0, 25),
        },
        userFields: {
          userField: [
            { name: 'source', value: 'FoundaPay ERP' },
            { name: 'entity', value: process.env.AUTHNET_ENTITY || 'Designory Inc' },
          ],
        },
      },
    },
  };

  try {
    const data = await authnetPost(payload);
    const tx = data.transactionResponse;
    const messages = data.messages;

    if (messages?.resultCode === 'Ok' && tx && tx.responseCode === '1') {
      return {
        success: true,
        transactionId: tx.transId,
        authCode: tx.authCode,
        accountNumber: tx.accountNumber,
        accountType: tx.accountType,
        last4: (tx.accountNumber || cardNumber).slice(-4),
        message: tx.messages?.[0]?.description || 'Approved',
        responseCode: tx.responseCode,
        avsResultCode: tx.avsResultCode,
        cvvResultCode: tx.cvvResultCode,
      };
    }
    return {
      success: false,
      transactionId: tx?.transId || null,
      errorCode: tx?.errors?.[0]?.errorCode || messages?.message?.[0]?.code,
      message:
        tx?.errors?.[0]?.errorText ||
        messages?.message?.[0]?.text ||
        'Transaction declined',
      responseCode: tx?.responseCode,
    };
  } catch (e) {
    return {
      success: false,
      message: `Authorize.net error: ${e.message}`,
      errorCode: 'NETWORK_ERROR',
    };
  }
}

// ━━━ 2. GENERATE HOSTED PAYMENT PAGE TOKEN ───────────────
// Calls Authorize.net's getHostedPaymentPageRequest. The token Authorize.net
// returns is valid on their side for ~15 minutes. We do NOT send this URL
// directly to customers — see generatePaymentLink + GET /pay/:token, which
// regenerate this token lazily on each click so the link itself doesn't expire.
async function generateHostedPaymentLink(params) {
  if (!isConfigured()) {
    return {
      success: false,
      errorCode: 'NOT_CONFIGURED',
      errorText: 'Authorize.net credentials not configured',
      message: 'Authorize.net credentials not configured',
    };
  }
  const {
    amount, description, invoiceNumber, email,
    returnUrl, cancelUrl, brandName, refId,
  } = params;

  const finalRefId = String(refId || invoiceNumber || `FP-${Date.now()}`).slice(0, 20);

  const payload = {
    getHostedPaymentPageRequest: {
      merchantAuthentication: getAuth(),
      refId: finalRefId,
      transactionRequest: {
        transactionType: 'authCaptureTransaction',
        amount: parseFloat(amount).toFixed(2),
        order: {
          invoiceNumber: (invoiceNumber || `INV-${Date.now()}`).slice(0, 20),
          description: (description || 'FoundaPay Payment').slice(0, 255),
        },
        customer: { email: email || '' },
      },
      hostedPaymentSettings: {
        setting: [
          {
            settingName: 'hostedPaymentReturnOptions',
            settingValue: JSON.stringify({
              showReceipt: true,
              url: returnUrl || 'https://portal.foundapay.com',
              urlText: 'Return to Portal',
              cancelUrl: cancelUrl || 'https://portal.foundapay.com',
              cancelUrlText: 'Cancel',
            }),
          },
          { settingName: 'hostedPaymentButtonOptions', settingValue: JSON.stringify({ text: 'Pay Now' }) },
          { settingName: 'hostedPaymentStyleOptions',  settingValue: JSON.stringify({ bgColor: '#7C3AED' }) },
          {
            settingName: 'hostedPaymentPaymentOptions',
            settingValue: JSON.stringify({
              cardCodeRequired: true,
              showCreditCard: true,
              showBankAccount: false,
            }),
          },
          {
            settingName: 'hostedPaymentOrderOptions',
            settingValue: JSON.stringify({
              show: true,
              merchantName: brandName || 'FoundaPay',
            }),
          },
          {
            settingName: 'hostedPaymentCustomerOptions',
            settingValue: JSON.stringify({
              showEmail: true,
              requiredEmail: false,
              addPaymentProfile: false,
            }),
          },
          { settingName: 'hostedPaymentSecurityOptions', settingValue: JSON.stringify({ captcha: false }) },
        ],
      },
    },
  };

  try {
    const data = await authnetPost(payload);
    const token = data.token;
    const messages = data.messages;

    if (!token || messages?.resultCode !== 'Ok') {
      const codes = (messages?.message || [])
        .map((m) => `${m.code}:${m.text}`)
        .join(' | ');
      console.error(
        `[authnet hosted ERROR] refId=${finalRefId} resultCode=${messages?.resultCode || 'n/a'} codes=[${codes}]`
      );
      try {
        console.error('[authnet hosted ERROR] full response:', JSON.stringify(data));
      } catch { /* circular — ignore */ }
      return {
        success: false,
        errorCode: messages?.message?.[0]?.code || 'UNKNOWN',
        errorText: messages?.message?.[0]?.text || 'Failed to generate hosted payment page',
        message: messages?.message?.[0]?.text || 'Failed to generate hosted payment page',
        refId: finalRefId,
        rawMessages: messages?.message || [],
      };
    }

    console.log(
      `[authnet hosted ok] refId=${finalRefId} token=${token.slice(0, 10)}… amount=${parseFloat(amount).toFixed(2)} ttl=15m`
    );

    return {
      success: true,
      token,
      hostedUrl: `${HOSTED_BASE}?token=${encodeURIComponent(token)}`,
      // Authorize.net hosted-page tokens are valid for ~15 minutes upstream.
      // This is THEIR limit, not ours — our /pay/:token wrapper outlives it.
      upstreamExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      refId: finalRefId,
    };
  } catch (e) {
    console.error(`[authnet hosted ERROR] refId=${finalRefId} network/exception: ${e.message}`);
    return {
      success: false,
      errorCode: 'NETWORK_ERROR',
      errorText: e.message,
      message: `Authorize.net error: ${e.message}`,
      refId: finalRefId,
    };
  }
}

// ━━━ 3. VOID (same-day only) ─────────────────────────────
async function voidTransaction(transactionId) {
  if (!transactionId) return { success: false, message: 'transactionId required' };
  const payload = {
    createTransactionRequest: {
      merchantAuthentication: getAuth(),
      transactionRequest: {
        transactionType: 'voidTransaction',
        refTransId: transactionId,
      },
    },
  };
  try {
    const data = await authnetPost(payload);
    const tx = data.transactionResponse;
    return {
      success: tx?.responseCode === '1',
      transactionId: tx?.transId,
      message: tx?.messages?.[0]?.description || tx?.errors?.[0]?.errorText || data.messages?.message?.[0]?.text,
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ━━━ 4. REFUND ────────────────────────────────────────────
async function refundTransaction({ transactionId, amount, cardLast4, expirationDate }) {
  if (!transactionId || !amount) {
    return { success: false, message: 'transactionId and amount required' };
  }
  const payload = {
    createTransactionRequest: {
      merchantAuthentication: getAuth(),
      transactionRequest: {
        transactionType: 'refundTransaction',
        amount: parseFloat(amount).toFixed(2),
        payment: {
          creditCard: {
            cardNumber: cardLast4 || 'XXXX',
            expirationDate: expirationDate || 'XXXX',
          },
        },
        refTransId: transactionId,
      },
    },
  };
  try {
    const data = await authnetPost(payload);
    const tx = data.transactionResponse;
    return {
      success: tx?.responseCode === '1',
      refundTransactionId: tx?.transId,
      message: tx?.messages?.[0]?.description || tx?.errors?.[0]?.errorText || data.messages?.message?.[0]?.text,
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ━━━ 5. GET TRANSACTION DETAILS ──────────────────────────
async function getTransactionDetails(transactionId) {
  const payload = {
    getTransactionDetailsRequest: {
      merchantAuthentication: getAuth(),
      transId: transactionId,
    },
  };
  try {
    const data = await authnetPost(payload);
    return data.transaction || null;
  } catch {
    return null;
  }
}

// ━━━ 6. TEST CONNECTION ──────────────────────────────────
async function testConnection() {
  if (!isConfigured()) {
    return { success: false, message: 'Authorize.net credentials not configured', sandbox: process.env.AUTHNET_SANDBOX === 'true' };
  }
  const payload = {
    authenticateTestRequest: {
      merchantAuthentication: getAuth(),
    },
  };
  try {
    const data = await authnetPost(payload);
    return {
      success: data.messages?.resultCode === 'Ok',
      message: data.messages?.message?.[0]?.text || 'Connected',
      sandbox: process.env.AUTHNET_SANDBOX === 'true',
      entity: process.env.AUTHNET_ENTITY || null,
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ━━━ 7. WEBHOOK SIGNATURE VERIFICATION ───────────────────
function verifySignature(payload, signature) {
  if (!process.env.AUTHNET_SIGNATURE_KEY || !signature) return false;
  const hash = crypto
    .createHmac('sha512', process.env.AUTHNET_SIGNATURE_KEY)
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest('hex')
    .toUpperCase();
  return hash === String(signature).toUpperCase();
}

// ━━━ 8. CHARGE WITH OPAQUE DATA (Accept.js nonce, SAQ-A) ─
// dataValue + dataDescriptor come from the browser's Accept.js — server
// never sees raw PAN. Same fields go where creditCard goes in chargeCard().
async function chargeWithOpaqueData(params) {
  if (!isConfigured()) {
    return { success: false, message: 'Authorize.net credentials not configured' };
  }
  const {
    amount, dataValue, dataDescriptor,
    firstName, lastName, email, phone,
    description, invoiceNumber, address, city, zip, country,
  } = params;

  const payload = {
    createTransactionRequest: {
      merchantAuthentication: getAuth(),
      refId: (invoiceNumber || `FP-${Date.now()}`).slice(0, 20),
      transactionRequest: {
        transactionType: 'authCaptureTransaction',
        amount: parseFloat(amount).toFixed(2),
        payment: {
          opaqueData: { dataDescriptor, dataValue },
        },
        order: {
          invoiceNumber: (invoiceNumber || `INV-${Date.now()}`).slice(0, 20),
          description: (description || 'FoundaPay Payment').slice(0, 255),
        },
        customer: { email: email || '' },
        billTo: {
          firstName: (firstName || '').slice(0, 50),
          lastName: (lastName || '').slice(0, 50),
          address: (address || '').slice(0, 60),
          city: (city || '').slice(0, 40),
          zip: (zip || '').slice(0, 20),
          country: country || 'US',
          phoneNumber: (phone || '').slice(0, 25),
        },
        userFields: {
          userField: [
            { name: 'source', value: 'FoundaPay self-hosted page' },
            { name: 'entity', value: process.env.AUTHNET_ENTITY || 'Designory Inc' },
          ],
        },
      },
    },
  };

  try {
    const data = await authnetPost(payload);
    const tx = data.transactionResponse;
    const messages = data.messages;
    if (messages?.resultCode === 'Ok' && tx?.responseCode === '1') {
      return {
        success: true,
        transactionId: tx.transId,
        authCode: tx.authCode,
        accountNumber: tx.accountNumber,
        accountType: tx.accountType,
        last4: (tx.accountNumber || '').slice(-4),
        message: tx.messages?.[0]?.description || 'Approved',
        responseCode: tx.responseCode,
        avsResultCode: tx.avsResultCode || null,
        cvvResultCode: tx.cvvResultCode || null,
      };
    }
    return {
      success: false,
      transactionId: tx?.transId || null,
      errorCode: tx?.errors?.[0]?.errorCode || messages?.message?.[0]?.code,
      message: tx?.errors?.[0]?.errorText || messages?.message?.[0]?.text || 'Transaction declined',
      responseCode: tx?.responseCode || null,
      avsResultCode: tx?.avsResultCode || null,
      cvvResultCode: tx?.cvvResultCode || null,
    };
  } catch (e) {
    return { success: false, message: `Authorize.net error: ${e.message}` };
  }
}

// ━━━ 9. SELF-HOSTED PAYMENT-LINK TOKEN HELPERS ───────────
// HMAC-signed, base64url-encoded payload. Token = "<payload>.<sig>".
// Amount embedded in token is server-truth — client cannot tamper.
function tokenSecret() {
  return process.env.VT_ENCRYPTION_KEY || process.env.JWT_SECRET || 'foundapay-default-vt-key';
}

function signPayload(obj) {
  const json = JSON.stringify(obj);
  const enc = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret()).update(enc).digest('hex');
  return `${enc}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    throw new Error('Invalid token format');
  }
  const [enc, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', tokenSecret()).update(enc).digest('hex');
  // Constant-time compare to prevent timing attacks
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid token signature');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(enc, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Corrupt token payload');
  }
  if (!payload.exp || Date.now() > payload.exp) {
    const e = new Error('Token expired');
    e.code = 'EXPIRED';
    throw e;
  }
  return payload;
}

// ━━━ 10. GENERATE PAYMENT LINK — always our /pay/:token wrapper ─
// We no longer call upstream Authorize.net at link-generation time. Instead,
// we issue a signed self-hosted token (default TTL 24h) and the upstream
// hosted-page token is regenerated lazily inside GET /pay/:token whenever
// the customer clicks. This sidesteps Authorize.net's 15-minute upstream TTL.
//
// `method` controls click-time behavior, baked into the token payload:
//   'auto'            — try Authorize.net hosted first, fall back to Accept.js
//   'hosted_redirect' — always 302 to Authorize.net hosted (error page on fail)
//   'self_hosted'     — always render Accept.js on portal.foundapay.com
async function generatePaymentLink(params) {
  const expiryMinutes = parseInt(params.expiryMinutes || 1440, 10); // default 24h
  const exp = Date.now() + expiryMinutes * 60 * 1000;
  const method = ['auto', 'hosted_redirect', 'self_hosted'].includes(params.method)
    ? params.method
    : 'auto';

  const token = signPayload({
    amount: parseFloat(params.amount).toFixed(2),
    description: params.description || 'FoundaPay Payment',
    invoiceNumber: params.invoiceNumber || `INV-${Date.now()}`,
    customerEmail: params.email || '',
    brandName: params.brandName || process.env.AUTHNET_ENTITY || 'FoundaPay',
    logoUrl: params.logoUrl || null,
    returnUrl: params.returnUrl || null,
    method,
    exp,
    iat: Date.now(),
  });

  const portalUrl = process.env.PORTAL_URL || 'https://portal.foundapay.com';
  return {
    success: true,
    method,
    hostedUrl: `${portalUrl}/pay/${token}`,
    token,
    expiresAt: new Date(exp),
    expiresInMinutes: expiryMinutes,
  };
}

module.exports = {
  chargeCard,
  chargeWithOpaqueData,
  generateHostedPaymentLink,
  generatePaymentLink,
  voidTransaction,
  refundTransaction,
  getTransactionDetails,
  testConnection,
  verifySignature,
  signPayload,
  verifyToken,
  isConfigured,
};
