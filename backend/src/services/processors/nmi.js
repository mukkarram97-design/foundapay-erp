// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NMI (Network Merchants Inc) — direct gateway, form-encoded POST.
// ⚠ PCI: same caveat. Prefer NMI's Collect.js iframe in production.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ENDPOINT = 'https://secure.nmi.com/api/transact.php';

async function chargeCard({ amount, cardNumber, expDate, cvv, firstName, lastName, description }) {
  if (!process.env.NMI_SECURITY_KEY) {
    return { success: false, message: 'NMI security key not configured' };
  }

  const params = new URLSearchParams({
    security_key: process.env.NMI_SECURITY_KEY,
    type: 'sale',
    amount: Number(amount).toFixed(2),
    ccnumber: String(cardNumber).replace(/\s+/g, ''),
    ccexp: String(expDate).replace(/\D/g, '').padStart(4, '0'),
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
    return { success: false, message: `NMI error: ${e.message}` };
  }
}

module.exports = { chargeCard };
