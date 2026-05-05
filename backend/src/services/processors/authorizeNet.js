// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Authorize.net — direct card charge (auth + capture in one call)
//
// ⚠ PCI WARNING: this code accepts raw PAN. If you call this from a
// production endpoint, your server is in PCI DSS scope at SAQ-D. The
// safer path is Authorize.net Accept.js (hosted fields) which returns a
// payment nonce — pass that nonce instead of the card number and you
// drop to SAQ-A. See: https://developer.authorize.net/api/reference/features/acceptjs.html
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PROD_URL = 'https://api.authorize.net/xml/v1/request.api';
const SANDBOX_URL = 'https://apitest.authorize.net/xml/v1/request.api';

function endpoint() {
  return process.env.AUTHNET_SANDBOX === 'false' ? PROD_URL : SANDBOX_URL;
}

// chargeCard({ amount, cardNumber, expMonth, expYear, cvv, description, customer })
// Returns: { success, transactionId, authCode, message, raw }
async function chargeCard({ amount, cardNumber, expMonth, expYear, cvv, description, customer = {} }) {
  if (!process.env.AUTHNET_LOGIN_ID || !process.env.AUTHNET_TRANSACTION_KEY) {
    return { success: false, message: 'Authorize.net credentials not configured' };
  }

  const body = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: process.env.AUTHNET_LOGIN_ID,
        transactionKey: process.env.AUTHNET_TRANSACTION_KEY,
      },
      transactionRequest: {
        transactionType: 'authCaptureTransaction',
        amount: Number(amount).toFixed(2),
        payment: {
          creditCard: {
            cardNumber: String(cardNumber).replace(/\s+/g, ''),
            expirationDate: `${String(expMonth).padStart(2, '0')}${String(expYear).slice(-2)}`,
            cardCode: String(cvv),
          },
        },
        order: { description: (description || 'FoundaPay').slice(0, 255) },
        ...(customer.firstName || customer.lastName ? {
          billTo: {
            firstName: customer.firstName || '',
            lastName: customer.lastName || '',
            email: customer.email || undefined,
          },
        } : {}),
      },
    },
  };

  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Authorize.net returns JSON wrapped in BOM sometimes — strip and parse
    const txt = (await res.text()).replace(/^﻿/, '');
    const data = JSON.parse(txt);

    const tx = data.transactionResponse;
    const messages = data.messages;

    if (tx && tx.responseCode === '1') {
      return {
        success: true,
        transactionId: tx.transId,
        authCode: tx.authCode,
        message: tx.messages?.[0]?.description || 'Approved',
        last4: tx.accountNumber ? String(tx.accountNumber).slice(-4) : String(cardNumber).slice(-4),
        raw: data,
      };
    }

    const errMsg =
      tx?.errors?.[0]?.errorText
      || messages?.message?.[0]?.text
      || 'Transaction declined';

    return { success: false, message: errMsg, transactionId: tx?.transId, raw: data };
  } catch (e) {
    return { success: false, message: `Authorize.net error: ${e.message}` };
  }
}

module.exports = { chargeCard };
