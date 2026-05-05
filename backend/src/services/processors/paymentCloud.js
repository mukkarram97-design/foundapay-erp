// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PaymentCloud — sits on top of NMI gateway. Form-encoded POST.
// ⚠ PCI: same caveat as authorizeNet.js. Prefer their hosted form.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ENDPOINT = 'https://secure.paymentcloud.com/api/transact.php';

async function chargeCard({ amount, cardNumber, expDate, cvv, firstName, lastName, description }) {
  if (!process.env.PAYMENTCLOUD_USERNAME || !process.env.PAYMENTCLOUD_PASSWORD) {
    return { success: false, message: 'PaymentCloud credentials not configured' };
  }

  const params = new URLSearchParams({
    username: process.env.PAYMENTCLOUD_USERNAME,
    password: process.env.PAYMENTCLOUD_PASSWORD,
    type: 'sale',
    amount: Number(amount).toFixed(2),
    ccnumber: String(cardNumber).replace(/\s+/g, ''),
    ccexp: String(expDate).replace(/\D/g, '').padStart(4, '0'), // MMYY
    cvv: String(cvv),
    firstname: firstName || '',
    lastname: lastName || '',
    orderdescription: (description || 'FoundaPay').slice(0, 255),
  });

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const text = await res.text();
    // Response is URL-encoded form: response=1&transactionid=X&authcode=X&...
    const out = Object.fromEntries(new URLSearchParams(text));

    if (out.response === '1') {
      return {
        success: true,
        transactionId: out.transactionid,
        authCode: out.authcode,
        message: out.responsetext || 'Approved',
        last4: String(cardNumber).slice(-4),
        raw: out,
      };
    }
    return {
      success: false,
      message: out.responsetext || 'Declined',
      raw: out,
    };
  } catch (e) {
    return { success: false, message: `PaymentCloud error: ${e.message}` };
  }
}

module.exports = { chargeCard };
