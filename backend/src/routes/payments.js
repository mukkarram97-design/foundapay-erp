// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public payment routes — NO authentication required.
// These are hit by customers paying via a self-hosted payment link.
//
//   GET  /pay/:token         → renders the Accept.js HTML page
//   POST /api/pay/process    → charges via Authorize.net using the
//                              Accept.js opaque-data nonce + token amount
//
// Security:
//   - Token is HMAC-SHA256 signed (see authorizeNet.signPayload/verifyToken)
//   - Amount is read from the verified token, never from the client request
//   - Token has an exp; expired tokens return 410 Gone
//   - HTML output escapes all user-controllable values
//   - Card data never reaches us — Accept.js tokenises in the browser
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const { pool } = require('../db');
const authNet = require('../services/processors/authorizeNet');
const { recordTransaction } = require('../services/transactions');
const { logAudit } = require('../services/audit');

const router = express.Router();

function esc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function fmtMoney(n) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function expiredHtml(brandName) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Link expired</title>
<style>body{font-family:-apple-system,sans-serif;background:#f8f7ff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
.c{background:white;border-radius:16px;padding:40px;max-width:420px;text-align:center;box-shadow:0 4px 24px rgba(124,58,237,0.12)}
h1{color:#dc2626;margin:0 0 8px;font-size:22px}p{color:#6b7280;margin:8px 0}.brand{color:#7C3AED;font-weight:700;margin-bottom:16px}
</style></head><body><div class="c"><div class="brand">${esc(brandName || 'FoundaPay')}</div>
<h1>⏱ This payment link has expired</h1>
<p>Please request a new payment link from the merchant.</p></div></body></html>`;
}

function cancelledHtml(brandName) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Link cancelled</title>
<style>body{font-family:-apple-system,sans-serif;background:#f8f7ff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
.c{background:white;border-radius:16px;padding:40px;max-width:420px;text-align:center;box-shadow:0 4px 24px rgba(124,58,237,0.12)}
h1{color:#dc2626;margin:0 0 8px;font-size:22px}p{color:#6b7280;margin:8px 0}.brand{color:#7C3AED;font-weight:700;margin-bottom:16px}
</style></head><body><div class="c"><div class="brand">${esc(brandName || 'FoundaPay')}</div>
<h1>✕ This payment link was cancelled</h1>
<p>The merchant cancelled this link. Please contact them for a new one.</p></div></body></html>`;
}

function paidReceiptHtml({ brandName, logoUrl, invoiceNumber, amount, paidAt, txnId, authCode, last4, downloadUrl }) {
  const fmtAmt = fmtMoney(amount);
  const paidDate = paidAt ? new Date(paidAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : '—';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt — ${esc(invoiceNumber || '')}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(135deg,#f8f7ff 0%,#ede9fe 100%);min-height:100vh;margin:0;padding:24px;color:#1a1027}
.card{background:white;border-radius:16px;max-width:480px;margin:24px auto;box-shadow:0 8px 32px rgba(124,58,237,0.16);overflow:hidden}
.head{background:linear-gradient(135deg,#7C3AED,#5B21B6);color:#fff;padding:32px;text-align:center}
.head .check{width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,0.18);margin:0 auto 14px;display:flex;align-items:center;justify-content:center;font-size:36px}
.head h1{margin:0;font-size:22px;font-weight:600}
.head p{margin:6px 0 0;font-size:13px;opacity:0.85}
.body{padding:28px 32px}
.row{display:flex;justify-content:space-between;padding:8px 0;font-size:13px;border-bottom:1px solid #eee}
.row:last-child{border:none}
.row .l{color:#6b7280}
.row .v{font-family:ui-monospace,monospace;color:#1a1027}
.amount{font-size:36px;font-weight:700;color:#7C3AED;text-align:center;margin:18px 0 6px}
.label{color:#6b7280;font-size:11px;text-align:center;text-transform:uppercase;letter-spacing:0.08em}
.btn{display:block;background:#7C3AED;color:#fff;border:none;border-radius:10px;padding:12px 20px;font-size:14px;font-weight:600;text-decoration:none;text-align:center;margin-top:18px}
.btn:hover{background:#6D28D9}
.brand{text-align:center;color:#7C3AED;font-weight:700;font-size:15px;margin-bottom:6px}
.footer{text-align:center;color:#9ca3af;font-size:11px;margin-top:18px}
</style></head><body>
<div class="card">
  <div class="head">
    <div class="check">✓</div>
    <h1>Payment Received</h1>
    <p>This invoice has already been paid.</p>
  </div>
  <div class="body">
    ${logoUrl ? `<div style="text-align:center;margin-bottom:8px"><img src="${esc(logoUrl)}" alt="${esc(brandName)}" style="max-height:42px;max-width:200px;object-fit:contain"/></div>` : `<div class="brand">${esc(brandName || 'FoundaPay')}</div>`}
    <div class="label">Amount paid</div>
    <div class="amount">${esc(fmtAmt)}</div>
    <div class="row"><span class="l">Invoice</span><span class="v">${esc(invoiceNumber || '—')}</span></div>
    <div class="row"><span class="l">Paid on</span><span class="v">${esc(paidDate)}</span></div>
    ${txnId ? `<div class="row"><span class="l">Transaction</span><span class="v">${esc(txnId)}</span></div>` : ''}
    ${authCode ? `<div class="row"><span class="l">Auth code</span><span class="v">${esc(authCode)}</span></div>` : ''}
    ${last4 ? `<div class="row"><span class="l">Card</span><span class="v">••${esc(last4)}</span></div>` : ''}
    ${downloadUrl ? `<a href="${esc(downloadUrl)}" class="btn">Download Receipt PDF</a>` : ''}
    <div class="footer">Powered by <strong>FoundaPay</strong></div>
  </div>
</div>
</body></html>`;
}

// ━━━ Invoice payment page — full breakdown (line items, totals, due date) ━━━
// Used when /pay/:token comes from an invoice (token.invoiceId set + invoice
// fetched from DB). The customer-facing layout per spec.
function invoicePaymentHtml({ token, payload, invoice, related, apiLoginId, publicClientKey, acceptUiSrc }) {
  const amount = parseFloat(payload.amount).toFixed(2);
  const amountFmt = fmtMoney(payload.amount);
  let lineItems = invoice.line_items || [];
  if (typeof lineItems === 'string') {
    try { lineItems = JSON.parse(lineItems); } catch { lineItems = []; }
  }
  const taxPct = (parseFloat(invoice.tax_rate) || 0) * 100;
  const dueDate = invoice.due_date
    ? new Date(invoice.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const issuerName = related.entity_name || related.client_name || payload.brandName || 'FoundaPay';

  const itemRows = lineItems.map((li, i) => `
    <tr style="background:${i % 2 ? '#FAFAFA' : '#FFFFFF'}">
      <td style="padding:10px 12px">${esc(li.description || '—')}</td>
      <td style="padding:10px 12px;text-align:right;font-family:ui-monospace,monospace">${esc(String(li.quantity ?? '—'))}</td>
      <td style="padding:10px 12px;text-align:right;font-family:ui-monospace,monospace">${esc(fmtMoney(li.line_total))}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${esc(invoice.invoice_number)} — ${esc(issuerName)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="${acceptUiSrc}" charset="utf-8"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(135deg,#f8f7ff 0%,#ede9fe 100%);min-height:100vh;padding:24px;color:#1a1027}
    .card{background:#fff;border-radius:16px;max-width:560px;margin:0 auto;box-shadow:0 8px 32px rgba(124,58,237,0.16);overflow:hidden}
    .head{padding:28px 32px 22px;border-bottom:1px solid #eee}
    .brand-row{display:flex;align-items:center;gap:12px;margin-bottom:14px}
    .brand-text{font-size:18px;font-weight:700;color:#7C3AED}
    .invoice-num{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em}
    .invoice-title{font-size:24px;font-weight:700;color:#1a1027;margin-top:2px}
    .from-line{font-size:13px;color:#6b7280;margin-top:6px}
    .body{padding:24px 32px}
    .section-label{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin-bottom:6px}
    .billto{margin-bottom:18px}
    .billto-name{font-size:15px;color:#1a1027;font-weight:500}
    .billto-email{font-size:13px;color:#6b7280;margin-top:2px}
    table.items{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:13px}
    table.items th{background:#7C3AED;color:#fff;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600}
    table.items th.r{text-align:right}
    table.items td{border-bottom:1px solid #eee}
    .totals{margin-top:14px;padding-top:14px;border-top:1px solid #eee}
    .total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}
    .total-row .l{color:#6b7280}
    .total-row .v{font-family:ui-monospace,monospace;color:#1a1027}
    .total-row.grand{margin-top:8px;padding-top:10px;border-top:1px solid #eee;font-weight:700;font-size:16px}
    .total-row.grand .v{color:#7C3AED;font-size:18px}
    .meta{display:flex;justify-content:space-between;padding:14px 0;color:#6b7280;font-size:12px;border-top:1px solid #eee;margin-top:14px}
    .meta b{color:#1a1027;font-weight:500}
    .pay-row{margin-top:18px}
    button.AcceptUI{background:linear-gradient(135deg,#7C3AED 0%,#6D28D9 100%)!important;color:#fff!important;border:none!important;border-radius:12px!important;padding:14px 24px!important;font-size:16px!important;font-weight:600!important;cursor:pointer!important;width:100%!important;letter-spacing:0.01em!important;transition:transform 200ms,box-shadow 200ms!important}
    button.AcceptUI:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(124,58,237,0.35)!important}
    .secure{text-align:center;color:#9ca3af;font-size:11px;margin-top:14px}
    .secure b{color:#6b7280}
    .err{background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;border-radius:10px;padding:10px 12px;margin-top:14px;font-size:13px;display:none}
    .err.show{display:block}
    .pending{position:fixed;inset:0;background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;z-index:1000}
    .pending.show{display:flex}
    .pending div{background:#fff;border-radius:14px;padding:24px 32px;font-weight:600;color:#1a1027}
    .ok{text-align:center;padding:36px 32px}
    .ok h1{color:#10B981;font-size:28px;margin-bottom:8px}
    .ok p{color:#4b5563;margin-top:6px;font-size:14px}
    .ok code{font-family:ui-monospace,monospace;color:#7C3AED;background:#f3f0ff;padding:2px 6px;border-radius:4px;font-size:12px}
    @media (max-width:480px){.head,.body{padding-left:18px;padding-right:18px}.invoice-title{font-size:20px}}
  </style>
</head>
<body>
  <div class="card" id="card">
    <div class="head">
      <div class="brand-row">
        ${payload.logoUrl
          ? `<img src="${esc(payload.logoUrl)}" alt="${esc(issuerName)}" style="max-height:36px;max-width:140px;object-fit:contain"/>`
          : `<div class="brand-text">${esc(issuerName)}</div>`
        }
      </div>
      <div class="invoice-num">Invoice</div>
      <div class="invoice-title">${esc(invoice.invoice_number)}</div>
      <div class="from-line">From: <b>${esc(issuerName)}</b></div>
    </div>

    <div class="body">
      ${invoice.customer_name || invoice.customer_email ? `
      <div class="billto">
        <div class="section-label">Bill to</div>
        ${invoice.customer_name ? `<div class="billto-name">${esc(invoice.customer_name)}</div>` : ''}
        ${invoice.customer_email ? `<div class="billto-email">${esc(invoice.customer_email)}</div>` : ''}
      </div>` : ''}

      <div class="section-label">Items</div>
      <table class="items">
        <thead><tr>
          <th>Description</th>
          <th class="r">Qty</th>
          <th class="r">Amount</th>
        </tr></thead>
        <tbody>${itemRows || '<tr><td colspan="3" style="padding:14px;text-align:center;color:#6b7280">No items</td></tr>'}</tbody>
      </table>

      <div class="totals">
        <div class="total-row"><span class="l">Subtotal</span><span class="v">${esc(fmtMoney(invoice.subtotal))}</span></div>
        ${parseFloat(invoice.discount_amount) > 0 ? `<div class="total-row"><span class="l">Discount</span><span class="v">-${esc(fmtMoney(invoice.discount_amount))}</span></div>` : ''}
        ${taxPct > 0 ? `<div class="total-row"><span class="l">Tax (${taxPct.toFixed(2)}%)</span><span class="v">${esc(fmtMoney(invoice.tax_amount))}</span></div>` : ''}
        <div class="total-row grand"><span class="l">Total Due</span><span class="v">${esc(amountFmt)}</span></div>
      </div>

      ${dueDate ? `<div class="meta"><span>Due Date</span><b>${esc(dueDate)}</b></div>` : ''}

      <div class="pay-row">
        <button
          type="button"
          class="AcceptUI"
          data-billingAddressOptions='{"show":true,"required":false}'
          data-apiLoginID="${esc(apiLoginId)}"
          data-clientKey="${esc(publicClientKey)}"
          data-acceptUIFormBtnTxt="Pay ${esc(amountFmt)}"
          data-acceptUIFormHeaderTxt="Secure Payment"
          data-paymentOptions='{"showCreditCard":true,"showBankAccount":false}'
          data-responseHandler="responseHandler">
          Pay ${esc(amountFmt)} Securely
        </button>
      </div>

      <div id="err" class="err"></div>

      <div class="secure" style="margin-top:18px">🔒 <b>Card data sent directly to Authorize.net.</b></div>
      <div class="secure" style="margin-top:4px">Your card never touches FoundaPay's servers.</div>
      <div class="secure" style="margin-top:14px">Powered by <b>FoundaPay</b></div>
    </div>
  </div>

  <div class="pending" id="pending"><div>Processing payment…</div></div>

  <script>
    var TOKEN = ${JSON.stringify(token)};
    var BRAND = ${JSON.stringify(issuerName)};
    function showError(msg){var e=document.getElementById('err');e.textContent=msg;e.classList.add('show');}
    function responseHandler(response){
      if(response.messages.resultCode==='Error'){showError(response.messages.message[0].text||'Payment error');return;}
      document.getElementById('pending').classList.add('show');
      fetch('/api/pay/process',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token:TOKEN,
          dataDescriptor:response.opaqueData.dataDescriptor,
          dataValue:response.opaqueData.dataValue,
          customer:{
            firstName:response.customerInformation&&response.customerInformation.firstName||'',
            lastName:response.customerInformation&&response.customerInformation.lastName||'',
            email:response.customerInformation&&response.customerInformation.email||''
          }})
      }).then(function(r){return r.json();}).then(function(result){
        document.getElementById('pending').classList.remove('show');
        if(result.success){
          document.getElementById('card').innerHTML='<div class="ok">'+
            '<h1>✓ Payment Successful</h1>'+
            '<p>Thank you. Your payment of <b>'+(result.amountFmt||'')+'</b> has been received.</p>'+
            (result.authCode?'<p style="margin-top:14px">Auth code: <code>'+result.authCode+'</code></p>':'')+
            (result.transactionId?'<p>Transaction ID: <code>'+result.transactionId+'</code></p>':'')+
            '<p style="margin-top:18px;font-size:12px;color:#9ca3af">'+BRAND+'</p>'+
            '</div>';
          window.scrollTo(0,0);
        } else { showError(result.message||'Payment was declined.'); }
      }).catch(function(){
        document.getElementById('pending').classList.remove('show');
        showError('Network error. Please try again.');
      });
    }
  </script>
</body>
</html>`;
}

function notFoundHtml() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found</title>
<style>body{font-family:-apple-system,sans-serif;background:#f8f7ff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
.c{background:white;border-radius:16px;padding:40px;max-width:420px;text-align:center;box-shadow:0 4px 24px rgba(124,58,237,0.12)}
h1{color:#dc2626;margin:0;font-size:22px}p{color:#6b7280;margin-top:12px}
</style></head><body><div class="c"><h1>Invalid payment link</h1>
<p>This payment link is invalid or has been revoked.</p></div></body></html>`;
}

// In-memory dedup: don't log >1 view per IP+invoice within 60 seconds.
// Survives one process at a time; pm2 restart clears it (acceptable — at
// worst a single duplicate audit row across a restart boundary).
const VIEW_DEDUP_TTL_MS = 60_000;
const viewDedup = new Map();
function shouldLogView(ip, invoiceNumber) {
  const key = `${ip || 'unknown'}:${invoiceNumber || 'unknown'}`;
  const now = Date.now();
  const exp = viewDedup.get(key);
  if (exp && exp > now) return false;
  viewDedup.set(key, now + VIEW_DEDUP_TTL_MS);
  if (viewDedup.size > 5000) {
    for (const [k, e] of viewDedup) if (e < now) viewDedup.delete(k);
  }
  return true;
}

// Coarse user-agent → device class. Lightweight (no UAParser dep).
function deviceFromUA(ua) {
  if (!ua) return 'unknown';
  const s = String(ua).toLowerCase();
  if (/ipad|tablet|playbook|kindle/.test(s)) return 'tablet';
  if (/iphone|android.*mobile|mobile|opera mini|blackberry|iemobile|webos/.test(s)) return 'mobile';
  if (/bot|crawler|spider|crawl|slurp/.test(s)) return 'bot';
  return 'desktop';
}

// Real client IP (respects nginx X-Forwarded-For when present).
function realIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip;
}

async function trackView(payload, ip, userAgent) {
  if (!payload?.invoiceNumber) return;
  if (!shouldLogView(ip, payload.invoiceNumber)) return;
  const device = deviceFromUA(userAgent);
  try {
    // bump view_count + set viewed_at + capture first-opened device info
    await pool.query(`
      UPDATE payment_link_requests
         SET view_count = COALESCE(view_count, 0) + 1,
             viewed_at = COALESCE(viewed_at, NOW()),
             first_opened_at = COALESCE(first_opened_at, NOW()),
             first_opened_ip = COALESCE(first_opened_ip, $2::inet),
             first_opened_user_agent = COALESCE(first_opened_user_agent, $3),
             first_opened_device = COALESCE(first_opened_device, $4)
       WHERE invoice_number = $1
    `, [payload.invoiceNumber, ip || null, userAgent || null, device]);

    await logAudit({
      action: 'payment_link.viewed',
      entityType: 'payment_link_token',
      entityId: payload.invoiceNumber,
      metadata: { amount: payload.amount, brand: payload.brandName, device, ip },
      ipAddress: ip,
      userAgent,
    });
  } catch (e) {
    console.warn('[trackView] failed:', e.message);
  }
}

function processorErrorHtml(brandName, errorText, errorCode) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payment temporarily unavailable</title>
<style>body{font-family:-apple-system,sans-serif;background:#f8f7ff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
.c{background:white;border-radius:16px;padding:40px;max-width:460px;text-align:center;box-shadow:0 4px 24px rgba(124,58,237,0.12)}
h1{color:#b45309;margin:0 0 8px;font-size:22px}p{color:#6b7280;margin:8px 0;line-height:1.5}.brand{color:#7C3AED;font-weight:700;margin-bottom:16px}
small{color:#9ca3af;font-size:11px;font-family:ui-monospace,monospace;margin-top:14px;display:block}
</style></head><body><div class="c"><div class="brand">${esc(brandName || 'FoundaPay')}</div>
<h1>Payment temporarily unavailable</h1>
<p>We couldn't reach the payment processor right now. Please try again in a few moments, or contact the merchant for a fresh link.</p>
${errorCode ? `<small>Reference: ${esc(errorCode)} — ${esc(errorText || '')}</small>` : ''}
</div></body></html>`;
}

// ━━━ GET /pay/:token — verify our token, then either render Accept.js
//                       on our domain OR lazily mint a fresh Authorize.net
//                       hosted-page token and 302-redirect to it. ━━━
//
// Why lazy: Authorize.net hosted-page tokens are valid for ~15 minutes
// upstream. A pre-generated link sent in an email is dead by the time the
// customer reads it. By regenerating on click we make the customer-facing
// link's lifetime equal to OUR token's TTL (24h by default).
router.get('/pay/:token', async (req, res) => {
  let payload;
  try {
    payload = authNet.verifyToken(req.params.token);
  } catch (e) {
    if (e.code === 'EXPIRED') {
      res.status(410).type('html').send(expiredHtml(null));
      return;
    }
    res.status(404).type('html').send(notFoundHtml());
    return;
  }

  // ━━━ Pre-flight: short-circuit on already-paid / cancelled links ━━━
  // Looking up by invoice_number (set at link generation). On match we render
  // a branded receipt page instead of letting the customer pay again.
  if (payload.invoiceNumber) {
    try {
      const r = await pool.query(`
        SELECT plr.status, plr.paid_at, plr.transaction_id,
               t.processor_reference AS auth_code,
               t.external_txn_id     AS authnet_tx_id,
               t.card_last4
          FROM payment_link_requests plr
          LEFT JOIN transactions t ON t.id = plr.transaction_id
         WHERE plr.invoice_number = $1
         LIMIT 1
      `, [payload.invoiceNumber]);
      const row = r.rows[0];
      if (row?.status === 'paid') {
        const downloadUrl = row.transaction_id
          ? `/api/transactions/${row.transaction_id}/receipt`
          : null;
        res.setHeader('Cache-Control', 'no-store');
        res.type('html').send(paidReceiptHtml({
          brandName: payload.brandName,
          logoUrl: payload.logoUrl,
          invoiceNumber: payload.invoiceNumber,
          amount: payload.amount,
          paidAt: row.paid_at,
          txnId: row.authnet_tx_id,
          authCode: row.auth_code,
          last4: row.card_last4,
          downloadUrl,
        }));
        return;
      }
      if (row?.status === 'cancelled') {
        res.status(410).type('html').send(cancelledHtml(payload.brandName));
        return;
      }
    } catch (e) {
      console.warn('[pay/:token] paid-check failed:', e.message);
    }
  }

  // ━━━ Lazy upstream regen path ━━━
  // Default behavior unless the merchant explicitly chose self_hosted (Accept.js).
  const method = payload.method || 'auto';
  if (method === 'auto' || method === 'hosted_redirect') {
    const hosted = await authNet.generateHostedPaymentLink({
      amount: payload.amount,
      description: payload.description,
      invoiceNumber: payload.invoiceNumber,
      email: payload.customerEmail,
      brandName: payload.brandName,
      returnUrl: payload.returnUrl || undefined,
      refId: payload.invoiceNumber, // echoed in webhook for correlation
    });

    if (hosted.success) {
      // Don't cache the redirect — every click must mint a fresh upstream token.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.redirect(302, hosted.hostedUrl);
      return;
    }

    // Upstream failed.
    if (method === 'hosted_redirect') {
      console.error(
        `[pay/:token] upstream hosted-page failed (hosted_redirect mode) refId=${hosted.refId} code=${hosted.errorCode} text=${hosted.errorText}`
      );
      res.status(502).type('html').send(
        processorErrorHtml(payload.brandName, hosted.errorText, hosted.errorCode)
      );
      return;
    }
    // method === 'auto' — fall through to Accept.js so the customer can still pay.
    console.warn(
      `[pay/:token] upstream hosted-page failed in auto mode, falling back to Accept.js. refId=${hosted.refId} code=${hosted.errorCode} text=${hosted.errorText}`
    );
  }

  // ━━━ Self-hosted Accept.js path ━━━
  // Track customer view (fire-and-forget; render must not block on DB)
  trackView(payload, realIp(req), req.headers['user-agent']).catch(() => {});

  const apiLoginId = process.env.AUTHNET_LOGIN_ID || '';
  const publicClientKey = process.env.AUTHNET_PUBLIC_CLIENT_KEY || '';
  const acceptUiSrc = process.env.AUTHNET_SANDBOX === 'true'
    ? 'https://jstest.authorize.net/v3/AcceptUI.js'
    : 'https://js.authorize.net/v3/AcceptUI.js';

  const amount = parseFloat(payload.amount).toFixed(2);
  const amountFmt = fmtMoney(payload.amount);

  // CSP relaxation: AcceptUI loads from authorize.net + popups inline scripts
  res.setHeader('Content-Security-Policy', "default-src 'self' https://*.authorize.net; script-src 'self' 'unsafe-inline' https://*.authorize.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.authorize.net; frame-src 'self' https://*.authorize.net; connect-src 'self' https://*.authorize.net");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // ━━━ Detailed invoice page — when token came from invoice flow ━━━
  // Falls back to the simple page silently if the invoice can't be loaded
  // (deleted / DB error) so customer can still pay.
  if (payload.invoiceId) {
    try {
      const ir = await pool.query(`
        SELECT i.*,
               c.name AS client_name, c.logo_url AS client_logo_url,
               e.legal_name AS entity_name, e.logo_url AS entity_logo_url
          FROM invoices i
          LEFT JOIN clients c  ON c.id = i.client_id
          LEFT JOIN entities e ON e.id = i.entity_id
         WHERE i.id = $1 AND i.is_deleted = false
        `, [payload.invoiceId]);
      if (ir.rows.length) {
        const inv = ir.rows[0];
        return res.type('html').send(invoicePaymentHtml({
          token: req.params.token,
          payload,
          invoice: inv,
          related: {
            entity_name: inv.entity_name,
            client_name: inv.client_name,
          },
          apiLoginId, publicClientKey, acceptUiSrc,
        }));
      }
    } catch (e) {
      console.warn('[pay/:token] invoice render failed, falling back:', e.message);
    }
  }

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(payload.brandName)} — Secure Payment</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="${acceptUiSrc}" charset="utf-8"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(135deg,#f8f7ff 0%,#ede9fe 100%);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;color:#1a1027}
    .card{background:white;border-radius:16px;padding:32px;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(124,58,237,0.16)}
    .brand{font-size:20px;font-weight:700;color:#7C3AED;margin-bottom:6px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-top:24px;margin-bottom:4px}
    .amount{font-size:42px;font-weight:700;color:#1a1027;line-height:1;margin:6px 0}
    .meta{color:#6b7280;font-size:13px;margin-top:6px}
    .invoice{font-family:ui-monospace,monospace;font-size:12px;color:#9ca3af;margin-top:4px}
    .pay-row{margin-top:24px}
    button.AcceptUI{background:linear-gradient(135deg,#7C3AED 0%,#6D28D9 100%)!important;color:white!important;border:none!important;border-radius:12px!important;padding:14px 24px!important;font-size:16px!important;font-weight:600!important;cursor:pointer!important;width:100%!important;letter-spacing:0.01em!important;transition:transform 200ms,box-shadow 200ms!important}
    button.AcceptUI:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(124,58,237,0.35)!important}
    .secure{text-align:center;color:#9ca3af;font-size:11px;margin-top:18px}
    .secure b{color:#6b7280}
    .err{background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;border-radius:10px;padding:10px 12px;margin-top:14px;font-size:13px;display:none}
    .err.show{display:block}
    .pending{position:fixed;inset:0;background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;z-index:1000}
    .pending.show{display:flex}
    .pending div{background:white;border-radius:14px;padding:24px 32px;font-weight:600;color:#1a1027}
    .ok{text-align:center;padding:20px 0}
    .ok h1{color:#10B981;font-size:28px;margin-bottom:8px}
    .ok p{color:#4b5563;margin-top:6px;font-size:14px}
    .ok code{font-family:ui-monospace,monospace;color:#7C3AED;background:#f3f0ff;padding:2px 6px;border-radius:4px;font-size:12px}
  </style>
</head>
<body>
  <div class="card" id="card">
    ${payload.logoUrl
      ? `<img src="${esc(payload.logoUrl)}" alt="${esc(payload.brandName)}" style="max-height:48px;max-width:200px;object-fit:contain;margin-bottom:12px"/>`
      : `<div class="brand">${esc(payload.brandName)}</div>`
    }
    <div class="label">Amount due</div>
    <div class="amount">${esc(amountFmt)}</div>
    <div class="meta">${esc(payload.description || 'Payment')}</div>
    <div class="invoice">Invoice: ${esc(payload.invoiceNumber)}</div>

    ${payload.descriptorNote || payload.statementDescriptor ? `
    <div style="margin-top:18px;padding:10px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;font-size:12px;color:#9a3412;line-height:1.45">
      ${payload.statementDescriptor
        ? `<div style="font-weight:600;margin-bottom:2px">Charge will appear as <code style="font-family:ui-monospace,monospace;background:#fde68a;padding:1px 5px;border-radius:4px">${esc(payload.statementDescriptor)}</code> on your statement</div>`
        : ''}
      ${payload.descriptorNote ? `<div>${esc(payload.descriptorNote)}</div>` : ''}
    </div>
    ` : ''}

    <div class="pay-row">
      <button
        type="button"
        class="AcceptUI"
        data-billingAddressOptions='{"show":true,"required":false}'
        data-apiLoginID="${esc(apiLoginId)}"
        data-clientKey="${esc(publicClientKey)}"
        data-acceptUIFormBtnTxt="Pay ${esc(amountFmt)}"
        data-acceptUIFormHeaderTxt="Secure Payment"
        data-paymentOptions='{"showCreditCard":true,"showBankAccount":false}'
        data-responseHandler="responseHandler">
        Pay ${esc(amountFmt)}
      </button>
    </div>

    <div id="err" class="err"></div>

    <div class="secure" style="margin-top:24px">🔒 <b>Card data is sent directly to Authorize.net.</b></div>
    <div class="secure" style="margin-top:4px">Your card never touches FoundaPay's servers.</div>
    ${payload.supportEmail || payload.supportPhone ? `
    <div class="secure" style="margin-top:10px">Questions? ${payload.supportEmail ? `<a href="mailto:${esc(payload.supportEmail)}" style="color:#7c3aed;text-decoration:none">${esc(payload.supportEmail)}</a>` : ''}${payload.supportEmail && payload.supportPhone ? ' · ' : ''}${payload.supportPhone ? esc(payload.supportPhone) : ''}</div>
    ` : ''}
    <div class="secure" style="margin-top:14px">Powered by <b>FoundaPay</b></div>
  </div>

  <div class="pending" id="pending"><div>Processing payment…</div></div>

  <script>
    var TOKEN = ${JSON.stringify(req.params.token)};
    var AMOUNT = ${JSON.stringify(amount)};
    var BRAND = ${JSON.stringify(payload.brandName)};

    function showError(msg) {
      var e = document.getElementById('err');
      e.textContent = msg;
      e.classList.add('show');
    }

    function responseHandler(response) {
      if (response.messages.resultCode === 'Error') {
        showError(response.messages.message[0].text || 'Payment error');
        return;
      }
      document.getElementById('pending').classList.add('show');

      fetch('/api/pay/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: TOKEN,
          dataDescriptor: response.opaqueData.dataDescriptor,
          dataValue: response.opaqueData.dataValue,
          customer: {
            firstName: response.customerInformation && response.customerInformation.firstName || '',
            lastName: response.customerInformation && response.customerInformation.lastName || '',
            email: response.customerInformation && response.customerInformation.email || ''
          }
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        document.getElementById('pending').classList.remove('show');
        if (result.success) {
          document.getElementById('card').innerHTML =
            '<div class="ok">' +
              '<h1>✓ Payment Successful</h1>' +
              '<p>Thank you. Your payment of <b>' + (result.amountFmt || '') + '</b> has been received.</p>' +
              (result.authCode ? '<p style="margin-top:14px">Auth code: <code>' + result.authCode + '</code></p>' : '') +
              (result.transactionId ? '<p>Transaction ID: <code>' + result.transactionId + '</code></p>' : '') +
              '<p style="margin-top:18px;font-size:12px;color:#9ca3af">' + BRAND + '</p>' +
            '</div>';
          window.scrollTo(0, 0);
        } else {
          showError(result.message || 'Payment was declined.');
        }
      })
      .catch(function(err) {
        document.getElementById('pending').classList.remove('show');
        showError('Network error. Please try again.');
      });
    }
  </script>
</body>
</html>`);
});

// ━━━ POST /api/pay/process — charge using Accept.js nonce ━━━
//
// Phase 1 master-plan compliant:
//   - Charge BEFORE BEGIN (cannot roll back a real Authorize.net charge)
//   - SELECT FOR UPDATE on vt_transactions for concurrent-submission safety
//   - Idempotency: status='success' on entry → HTTP 410 + existing tx details
//   - Dual-write: master ledger (transactions) + vt_transactions UPDATE (not duplicate INSERT)
//   - payment_link_requests update by invoice_number on both success and failure
//   - 4 audit events: charge_attempted, charge_succeeded, charge_failed, charge_db_write_failed
router.post('/api/pay/process', express.json(), async (req, res) => {
  const { token, dataDescriptor, dataValue, customer } = req.body || {};
  if (!token || !dataDescriptor || !dataValue) {
    return res.status(400).json({ success: false, message: 'Missing token or payment data' });
  }

  // ━━━ 1. Verify HMAC token (server-truth amount + invoice) ━━━
  let payload;
  try {
    payload = authNet.verifyToken(token);
  } catch (e) {
    if (e.code === 'EXPIRED') {
      return res.status(410).json({ success: false, message: 'This payment link has expired.' });
    }
    return res.status(400).json({ success: false, message: 'Invalid payment link' });
  }
  const amount = parseFloat(payload.amount);
  if (!isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid amount on token' });
  }
  const ipAddress = realIp(req);
  const userAgent = req.headers['user-agent'];
  const payerDevice = deviceFromUA(userAgent);

  // ━━━ 2. Audit: charge attempt (BEFORE Authorize.net call) ━━━
  await logAudit({
    action: 'payment_link.charge_attempted',
    entityType: 'payment_link_token',
    entityId: payload.invoiceNumber,
    metadata: { amount, brand: payload.brandName, email: payload.customerEmail, device: payerDevice, ip: ipAddress },
    ipAddress, userAgent,
  });

  // ━━━ 3. Idempotency check — DB lookup BEFORE charging ━━━
  // If the originating vt_transactions row is already 'success', short-circuit
  // with HTTP 410 — NO Authorize.net call, NO duplicate transactions row.
  const existing = await pool.query(`
    SELECT vt.id AS vt_id, vt.status AS vt_status, vt.transaction_id,
           vt.client_id, vt.entity_id, vt.invoice_number,
           vt.processor_transaction_id, vt.processor_auth_code, vt.card_last4
      FROM vt_transactions vt
     WHERE vt.hosted_link_token = $1
       AND vt.charge_type = 'hosted_link'
     ORDER BY vt.created_at ASC
     LIMIT 1
  `, [token]);
  const originating = existing.rows[0] || null;

  if (originating && originating.vt_status === 'success') {
    return res.status(410).json({
      success: false,
      alreadyPaid: true,
      message: 'This payment has already been completed.',
      transactionId: originating.processor_transaction_id,
      authCode: originating.processor_auth_code,
      last4: originating.card_last4,
      amount: amount.toFixed(2),
    });
  }

  // ━━━ 4. Charge Authorize.net — BEFORE BEGIN ━━━
  // Cannot roll back a real charge. We do NOT hold a DB row lock during
  // the 3rd-party network call.
  const result = await authNet.chargeWithOpaqueData({
    amount, dataDescriptor, dataValue,
    firstName: customer?.firstName || '',
    lastName:  customer?.lastName  || '',
    email:     customer?.email || payload.customerEmail || '',
    description: payload.description,
    invoiceNumber: payload.invoiceNumber,
  });

  // ━━━ 5. Persist (transaction-bracketed) ━━━
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    // 5a. SELECT FOR UPDATE — lock the originating vt_transactions row.
    let lockedVt = null;
    if (originating) {
      const r = await c.query(
        `SELECT id, status, client_id, entity_id, invoice_number
           FROM vt_transactions
          WHERE id = $1
          FOR UPDATE`,
        [originating.vt_id]
      );
      lockedVt = r.rows[0];
      // Re-check under lock — another submission may have won the race.
      if (lockedVt && lockedVt.status === 'success') {
        await c.query('ROLLBACK');
        return res.status(410).json({
          success: false,
          alreadyPaid: true,
          message: 'This payment has already been completed.',
          amount: amount.toFixed(2),
        });
      }
    }

    const customerName = `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() || null;

    if (result.success) {
      // ━━━ 5b SUCCESS BRANCH ━━━
      // Lookup the client's card_pct so the master ledger row stores the actual
      // commission. Without this, every payment_link transaction was recorded
      // with foundapay_fee_pct=0 and fee_amount=0 (not just displayed wrong —
      // truly missing in DB). Payment links are always card → use card_pct.
      let feePct = 0;
      if (lockedVt?.client_id) {
        const cl = await c.query('SELECT card_pct FROM clients WHERE id = $1', [lockedVt.client_id]);
        feePct = parseFloat(cl.rows[0]?.card_pct) || 0;
      }
      const feeAmount = parseFloat((amount * feePct).toFixed(4));
      const netAmount = parseFloat((amount - feeAmount).toFixed(4));

      const tx = await recordTransaction(c, {
        amount,
        type: 'Received',
        clientId: lockedVt?.client_id || null,
        counterpartyType: 'Client',
        counterpartyName: customerName || (customer?.email || 'Anonymous payer'),
        entityId: lockedVt?.entity_id || null,
        paymentMethod: 'Debit/Credit Cards',
        feePct,                               // <- now populated
        feeAmount,                            // <- now populated
        netAmount,                            // <- explicitly set so it = gross - fee
        externalTxnId: result.transactionId,
        processorReference: result.authCode,
        cardLast4: result.last4,
        cardBrand: result.accountType,
        avsResult: result.avsResultCode || null,
        cvvResult: result.cvvResultCode || null,
        customerEmail: customer?.email || payload.customerEmail || null,
        customerName,
        status: 'Completed',
        source: 'payment_link',
        notes: `Payment link charge | Inv: ${payload.invoiceNumber} | ${payload.description || ''}`.slice(0, 500),
      });

      // UPDATE existing pending vt_transactions row (no duplicate INSERT)
      // Note: vt_transactions has no updated_at column on prod, so don't touch it.
      if (lockedVt) {
        await c.query(`
          UPDATE vt_transactions
             SET status = 'success',
                 processor_transaction_id = $1, processor_auth_code = $2,
                 processor_response_code = $3, processor_response_text = $4,
                 card_last4 = $5, card_type = $6, card_holder_name = $7,
                 customer_email = $8, transaction_id = $9
           WHERE id = $10
        `, [
          result.transactionId, result.authCode, result.responseCode,
          'Approved (self-hosted)',
          result.last4, result.accountType, customerName,
          customer?.email || payload.customerEmail || null,
          tx.id, lockedVt.id,
        ]);
      } else {
        // Legacy/orphan token — insert fresh vt_transactions row for audit
        await c.query(`
          INSERT INTO vt_transactions
            (processor, processor_transaction_id, processor_auth_code,
             processor_response_code, processor_response_text,
             card_last4, card_type, card_holder_name, customer_email,
             amount, charge_type, status, hosted_link_token,
             invoice_number, description, brand_name, transaction_id)
          VALUES ('authorize_net',$1,$2,$3,$4,$5,$6,$7,$8,$9,
                  'hosted_link','success',$10,$11,$12,$13,$14)
        `, [
          result.transactionId, result.authCode, result.responseCode,
          'Approved (self-hosted, orphan token)',
          result.last4, result.accountType, customerName,
          customer?.email || payload.customerEmail || null,
          amount.toFixed(2), token,
          payload.invoiceNumber, payload.description, payload.brandName,
          tx.id,
        ]);
      }

      // UPDATE payment_link_requests by invoice_number — also captures payer device
      if (lockedVt?.invoice_number) {
        await c.query(`
          UPDATE payment_link_requests
             SET status = 'paid', transaction_id = $1, paid_at = NOW(),
                 attempts = COALESCE(attempts, 0) + 1,
                 payer_ip = $3::inet, payer_user_agent = $4, payer_device_type = $5
           WHERE invoice_number = $2
             AND status NOT IN ('paid','cancelled','refunded')
        `, [tx.id, lockedVt.invoice_number, ipAddress || null, userAgent || null, payerDevice]);

        // Bridge: if this payment was made for an invoice (matching invoice_number),
        // flip the invoice to paid as well. Silent no-op if no invoice exists.
        await c.query(`
          UPDATE invoices
             SET status = 'paid', paid_at = NOW(),
                 paid_amount = COALESCE(paid_amount, total_amount),
                 transaction_id = $1, updated_at = NOW()
           WHERE invoice_number = $2 AND is_deleted = false
             AND status NOT IN ('paid','cancelled')
        `, [tx.id, lockedVt.invoice_number]);
      }

      // COMMIT — if THIS fails after the real charge: CRITICAL alert
      try {
        await c.query('COMMIT');
      } catch (commitErr) {
        await logAudit({
          action: 'payment_link.charge_db_write_failed',
          entityType: 'payment_link_token',
          entityId: payload.invoiceNumber,
          metadata: {
            critical: true,
            authnet_transaction_id: result.transactionId,
            authnet_auth_code: result.authCode,
            amount,
            invoice_number: payload.invoiceNumber,
            customer_email: customer?.email || payload.customerEmail || null,
            commit_error: commitErr.message,
          },
          ipAddress, userAgent,
        });
        console.error('[CRITICAL pay/process] commit failed after real charge', {
          authnet_tx: result.transactionId, amount, invoice: payload.invoiceNumber,
        });
        throw commitErr;
      }

      // Success audit (after COMMIT)
      await logAudit({
        action: 'payment_link.charge_succeeded',
        entityType: 'transactions',
        entityId: tx.id,
        metadata: {
          authnet_transaction_id: result.transactionId,
          amount, last4: result.last4, brand: result.accountType,
          payment_link_invoice: payload.invoiceNumber,
          device: payerDevice,
          ip: ipAddress,
        },
        ipAddress, userAgent,
      });

      return res.json({
        success: true,
        transactionId: result.transactionId,
        authCode: result.authCode,
        last4: result.last4,
        amount: amount.toFixed(2),
        amountFmt: fmtMoney(amount),
        message: result.message,
      });
    } else {
      // ━━━ 5c FAILURE BRANCH ━━━
      const tx = await recordTransaction(c, {
        amount,
        type: 'Received',
        clientId: lockedVt?.client_id || null,
        counterpartyType: 'Client',
        counterpartyName: customerName || (customer?.email || 'Anonymous payer'),
        entityId: lockedVt?.entity_id || null,
        paymentMethod: 'Debit/Credit Cards',
        externalTxnId: result.transactionId || null,
        cardLast4: null,
        cardBrand: null,
        avsResult: result.avsResultCode || null,
        cvvResult: result.cvvResultCode || null,
        customerEmail: customer?.email || payload.customerEmail || null,
        customerName,
        status: 'Failed',
        source: 'payment_link',
        failureCode: result.errorCode || 'DECLINED',
        failureMessage: result.message || 'Transaction declined',
        failureResponseRaw: {
          errorCode: result.errorCode,
          message: result.message,
          responseCode: result.responseCode,
          transactionId: result.transactionId,
          avsResultCode: result.avsResultCode,
          cvvResultCode: result.cvvResultCode,
        },
        notes: `Failed payment link charge | Inv: ${payload.invoiceNumber}`.slice(0, 500),
      });

      // Update originating vt_transactions to 'declined'
      if (lockedVt) {
        await c.query(`
          UPDATE vt_transactions
             SET status = 'declined',
                 processor_response_text = $1,
                 transaction_id = $2
           WHERE id = $3
        `, [result.message || 'Declined', tx.id, lockedVt.id]);
      }

      // Bump plr.attempts + set last_error (link still usable for retry)
      if (lockedVt?.invoice_number) {
        await c.query(`
          UPDATE payment_link_requests
             SET attempts = COALESCE(attempts, 0) + 1,
                 last_error = $1
           WHERE invoice_number = $2
             AND status NOT IN ('paid','cancelled','refunded')
        `, [
          `${result.errorCode || 'DECLINED'}: ${result.message || 'Transaction declined'}`,
          lockedVt.invoice_number,
        ]);
      }

      await c.query('COMMIT');

      await logAudit({
        action: 'payment_link.charge_declined',
        entityType: 'transactions',
        entityId: tx.id,
        metadata: {
          code: result.errorCode || 'DECLINED',
          message: result.message,
          amount,
          payment_link_invoice: payload.invoiceNumber,
        },
        ipAddress, userAgent,
      });

      return res.json({ success: false, message: result.message || 'Payment declined' });
    }
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* swallowed */ }
    // CRITICAL: if Authnet already succeeded but DB write failed, log enough
    // info to manually reconcile. This fires for any error after the charge,
    // not just COMMIT failures.
    if (result?.success) {
      await logAudit({
        action: 'payment_link.charge_db_write_failed',
        entityType: 'payment_link_token',
        entityId: payload.invoiceNumber,
        metadata: {
          critical: true,
          authnet_transaction_id: result.transactionId,
          authnet_auth_code: result.authCode,
          last4: result.last4,
          card_brand: result.accountType,
          amount,
          invoice_number: payload.invoiceNumber,
          customer_email: customer?.email || payload.customerEmail || null,
          db_error: err.message,
          error_code: err.code,
        },
        ipAddress, userAgent,
      });
      console.error('[CRITICAL pay/process] charge succeeded but DB write failed', {
        authnet_tx: result.transactionId, auth_code: result.authCode,
        amount, invoice: payload.invoiceNumber, err: err.message,
      });
    } else {
      console.error('[pay/process]', err);
    }
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    c.release();
  }
});

module.exports = router;
