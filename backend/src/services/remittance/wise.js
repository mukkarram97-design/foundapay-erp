// Provider-shaped wrapper around the existing services/wise.js so the
// router in services/remittance/index.js can talk to Wise via a uniform
// interface.

const wiseClient = require('../wise');

function describe() {
  return {
    id: 'wise',
    label: 'Wise',
    supportsBalance: true,
    supportsAutomatedTransfer: true,
    configured: wiseClient.isConfigured(),
  };
}

module.exports = {
  describe,
  isConfigured: wiseClient.isConfigured,
  getBalances:    wiseClient.getBalances,
  createQuote:    wiseClient.createQuote,
  listRecipients: wiseClient.listRecipients,
  createRecipient: wiseClient.createRecipient,
  createTransfer: wiseClient.createTransfer,
  fundTransfer:   wiseClient.fundTransfer,
  getTransfer:    wiseClient.getTransfer,
  getReceipt:     wiseClient.getReceipt,
};
