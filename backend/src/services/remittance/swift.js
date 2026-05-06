// SWIFT provider — stub. Will hit a SWIFT gateway (custodian bank API) when wired.

function describe() {
  return { id: 'swift', label: 'SWIFT', supportsBalance: false, supportsAutomatedTransfer: false, configured: false };
}
function isConfigured() { return false; }

module.exports = { describe, isConfigured };
