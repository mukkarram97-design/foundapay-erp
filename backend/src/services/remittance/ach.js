// ACH provider — stub. Will hit an ACH gateway (Plaid Transfer / Modern Treasury) when wired.

function describe() {
  return { id: 'ach', label: 'ACH', supportsBalance: false, supportsAutomatedTransfer: false, configured: false };
}
function isConfigured() { return false; }

module.exports = { describe, isConfigured };
