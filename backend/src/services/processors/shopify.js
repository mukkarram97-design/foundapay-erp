// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shopify — different model. The Admin API does NOT charge cards directly;
// it creates orders. To take payment you either:
//   (a) link a Shopify Payments account and use checkout URLs (we use this)
//   (b) record an order with payment_gateway: 'manual' and reconcile later
//
// chargeCard() here creates an order with manual payment, returns the order
// reference + checkout URL the customer can pay through. No raw card data
// is sent to Shopify by us.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function apiBase() {
  const dom = process.env.SHOPIFY_STORE_DOMAIN;
  const v = process.env.SHOPIFY_API_VERSION || '2024-01';
  if (!dom) return null;
  return `https://${dom}/admin/api/${v}`;
}

async function shopifyFetch(path, init = {}) {
  const base = apiBase();
  if (!base || !process.env.SHOPIFY_ACCESS_TOKEN) {
    throw new Error('Shopify credentials not configured');
  }
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) {
    const err = new Error(data?.errors ? JSON.stringify(data.errors) : `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

// chargeCard signature kept compatible with the other processors,
// but card details are ignored — Shopify customer pays via checkout URL.
async function chargeCard({ amount, description, customer = {}, lineItems }) {
  try {
    const items = (lineItems && lineItems.length)
      ? lineItems
      : [{ title: description || 'FoundaPay charge', price: Number(amount).toFixed(2), quantity: 1 }];

    const orderBody = {
      order: {
        line_items: items,
        financial_status: 'pending',
        send_receipt: false,
        send_fulfillment_receipt: false,
        note: description || 'FoundaPay manual order',
        customer: customer.email ? { email: customer.email, first_name: customer.firstName, last_name: customer.lastName } : undefined,
      },
    };

    const data = await shopifyFetch('/orders.json', { method: 'POST', body: JSON.stringify(orderBody) });
    const order = data.order;
    return {
      success: true,
      transactionId: String(order.id),
      authCode: order.name,
      message: `Shopify order ${order.name} created`,
      checkoutUrl: order.order_status_url,
      last4: null,
      raw: order,
    };
  } catch (e) {
    return { success: false, message: `Shopify error: ${e.message}` };
  }
}

async function getTransactions({ orderId }) {
  try {
    const data = await shopifyFetch(`/orders/${orderId}/transactions.json`);
    return { success: true, transactions: data.transactions || [] };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

module.exports = { chargeCard, getTransactions };
