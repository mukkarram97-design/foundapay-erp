// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Remittance provider router.
//
// Each provider exposes the same shape:
//   isConfigured() → boolean
//   describe() → { id, label, supportsBalance, supportsAutomatedTransfer }
//   getBalances?()                          (only when supportsBalance)
//   createQuote?(...)                       (only when supportsAutomatedTransfer)
//   listRecipients?(...)                    (optional)
//   createRecipient?(...)                   (optional)
//   createTransfer?(...)                    (only when supportsAutomatedTransfer)
//   fundTransfer?(...)                      (only when supportsAutomatedTransfer)
//   getTransfer?(...)                       (only when supportsAutomatedTransfer)
//   recordTransfer({ ... }) → { remittance } (used by 'manual')
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const wise = require('./wise');
const manual = require('./manual');
const swift = require('./swift');
const ach = require('./ach');

const PROVIDERS = { wise, manual, swift, ach };

function get(providerId) {
  const p = PROVIDERS[String(providerId || 'wise').toLowerCase()];
  if (!p) {
    const e = new Error(`Unknown remittance provider: ${providerId}`);
    e.status = 400;
    throw e;
  }
  return p;
}

function list() {
  return Object.values(PROVIDERS).map((p) => p.describe());
}

module.exports = { get, list, PROVIDERS };
