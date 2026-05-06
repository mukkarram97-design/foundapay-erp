// Manual wire transfer — no API. Records-only provider that lets the team
// log a wire they've already initiated through their bank, and upload proof
// later via the approvals system.

function describe() {
  return {
    id: 'manual',
    label: 'Manual Wire',
    supportsBalance: false,
    supportsAutomatedTransfer: false,
    configured: true,
  };
}

function isConfigured() { return true; }

// recordTransfer is the single hook the route layer calls for a manual wire.
// It does not contact any external API; the route is responsible for
// inserting the remittances row.
function recordTransfer({ amount, currency, recipientName, recipientBank, recipientAccount, reference }) {
  if (!amount || !recipientName) {
    const e = new Error('amount and recipientName required for manual wire');
    e.status = 400;
    throw e;
  }
  return {
    ok: true,
    provider: 'manual',
    note: 'Manual wire — record only. Upload bank confirmation as proof.',
  };
}

module.exports = { describe, isConfigured, recordTransfer };
