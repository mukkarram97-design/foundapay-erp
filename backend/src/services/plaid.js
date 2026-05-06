// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plaid SDK wrapper.
//
// Env:
//   PLAID_CLIENT_ID
//   PLAID_SECRET
//   PLAID_ENV         sandbox | development | production  (default: sandbox)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');

let _client = null;
function getClient() {
  if (_client) return _client;
  const env = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
  const config = new Configuration({
    basePath: PlaidEnvironments[env] || PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
        'Plaid-Version': '2020-09-14',
      },
    },
  });
  _client = new PlaidApi(config);
  return _client;
}

function isConfigured() {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

// Create a Link token. The frontend uses this to open Plaid Link.
async function createLinkToken({ userId, products }) {
  const client = getClient();
  const r = await client.linkTokenCreate({
    user: { client_user_id: String(userId || 'foundapay-user') },
    client_name: 'FoundaPay',
    products: products || [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });
  return r.data; // { link_token, expiration }
}

// Exchange a public_token (returned to the frontend on Link success)
// for a permanent access_token + item_id.
async function exchangePublicToken(publicToken) {
  const client = getClient();
  const r = await client.itemPublicTokenExchange({ public_token: publicToken });
  return r.data; // { access_token, item_id }
}

// Fetch institution + account metadata for an item.
async function getAccountInfo(accessToken) {
  const client = getClient();
  const r = await client.accountsGet({ access_token: accessToken });
  return r.data; // { accounts, item }
}

async function getInstitution(institutionId) {
  const client = getClient();
  const r = await client.institutionsGetById({
    institution_id: institutionId,
    country_codes: [CountryCode.Us],
  });
  return r.data.institution;
}

// Pull transactions via the /transactions/sync endpoint (cursor-based).
// Returns: { added, modified, removed, next_cursor, has_more }
async function syncTransactions(accessToken, cursor) {
  const client = getClient();
  const r = await client.transactionsSync({
    access_token: accessToken,
    cursor: cursor || undefined,
    count: 500,
  });
  return r.data;
}

async function getBalances(accessToken) {
  const client = getClient();
  const r = await client.accountsBalanceGet({ access_token: accessToken });
  return r.data;
}

module.exports = {
  isConfigured,
  createLinkToken,
  exchangePublicToken,
  getAccountInfo,
  getInstitution,
  syncTransactions,
  getBalances,
};
