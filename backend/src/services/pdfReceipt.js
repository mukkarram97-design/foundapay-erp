// PDF receipt + statement generators using pdfkit
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const PURPLE = '#7C3AED';
const PURPLE_DARK = '#5B21B6';
const PURPLE_LIGHT = '#EDE9FE';
const TEXT_DARK = '#1A1027';
const TEXT_MUTED = '#6B7280';
const BORDER = '#E5E7EB';
const PAID_GREEN = '#16a34a';
const REFUND_RED = '#dc2626';
const UPLOADS_PREFIX = '/uploads/';
const UPLOADS_DISK_ROOT = '/var/www/foundapay/uploads/';

// Resolve logo URL ('/uploads/logos/x.png') to a local file path on the VPS.
// Returns null if the URL is malformed, the file doesn't exist, or it's an
// unsupported format (pdfkit can't render SVG).
function resolveLogoPath(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return null;
  if (!logoUrl.startsWith(UPLOADS_PREFIX)) return null;
  const ext = path.extname(logoUrl).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return null;
  const rel = logoUrl.slice(UPLOADS_PREFIX.length);
  const abs = path.join(UPLOADS_DISK_ROOT, rel);
  if (!abs.startsWith(UPLOADS_DISK_ROOT)) return null; // path-traversal guard
  try { fs.accessSync(abs, fs.constants.R_OK); return abs; }
  catch { return null; }
}

// Programmatic PAID watermark — no image asset, no missing-file failures.
// Rotated 15°, green-600, semi-transparent. Doesn't obscure financial details
// because we position it in the upper-right corner of the body area.
function drawPaidStamp(doc, { x = 380, y = 140 } = {}) {
  doc.save();
  doc.translate(x, y);
  doc.rotate(-15);
  doc.lineWidth(3);
  doc.strokeColor(PAID_GREEN);
  doc.fillColor(PAID_GREEN);
  doc.opacity(0.85);
  doc.roundedRect(0, 0, 160, 80, 8).stroke();
  doc.fontSize(36).font('Helvetica-Bold')
     .text('PAID', 0, 12, { width: 160, align: 'center' });
  doc.fontSize(8).font('Helvetica')
     .text('TRANSACTION COMPLETE', 0, 56, { width: 160, align: 'center' });
  doc.opacity(1);
  doc.restore();
  // TODO: add drawRefundedStamp variant in red when refund-tracking ships
}

const STATUS_COLORS = {
  Completed: { bg: '#D1FAE5', fg: '#065F46', label: 'PAID' },
  Hold: { bg: '#FEF3C7', fg: '#92400E', label: 'ON HOLD ⚠' },
  'Charge Back': { bg: '#FEE2E2', fg: '#991B1B', label: 'CHARGEBACK ✗' },
  Processing: { bg: '#DBEAFE', fg: '#1E40AF', label: 'PROCESSING' },
  Failed: { bg: '#FEE2E2', fg: '#991B1B', label: 'FAILED' },
};

function fmtMoney(n) {
  const v = parseFloat(n) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v);
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ━━━ Receipt — single transaction ─────────────────────────
function buildReceipt(tx, related = {}, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(stream);

  // Header — purple bar (FoundaPay platform branding)
  doc.rect(0, 0, doc.page.width, 80).fill(PURPLE);
  doc.fillColor('#FFFFFF').fontSize(28).font('Helvetica-Bold').text('Founda Pay', 40, 28);
  doc.fontSize(11).font('Helvetica').text('TRANSACTION RECEIPT', 0, 36, { width: doc.page.width - 40, align: 'right' });

  // Reset
  doc.fillColor(TEXT_DARK);

  // Brand strip — client/entity logo + name (whose payment this is)
  // Sits below the platform header. Logo top-left if present; else just text.
  const logoPath = resolveLogoPath(related.logo_url);
  const brandName = related.entity_name || related.client_name || tx.counterparty_name || '';
  let stripBottom = 95;
  if (logoPath || brandName) {
    if (logoPath) {
      try {
        doc.image(logoPath, 40, 90, { fit: [120, 32], align: 'left', valign: 'center' });
      } catch (e) {
        // If pdfkit can't decode the file, fall back to text silently
        doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_DARK).text(brandName, 40, 96);
      }
      stripBottom = 130;
    } else if (brandName) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_DARK).text(brandName, 40, 96);
      stripBottom = 120;
    }
  }

  // PAID stamp — only on completed transactions, upper-right area below header.
  // Drawn programmatically (no image asset → no missing-file failures).
  const isPaid = (tx.status || '').toLowerCase() === 'completed' || (tx.status || '').toLowerCase() === 'paid';
  if (isPaid) {
    drawPaidStamp(doc, { x: doc.page.width - 200, y: 95 });
  }

  // Receipt meta
  let y = Math.max(stripBottom + 10, 130);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(TEXT_DARK).text(`Receipt #TXN-${tx.id}`, 40, y);
  doc.font('Helvetica').fontSize(10).fillColor(TEXT_MUTED)
    .text(`Date: ${fmtDate(tx.date_received)}`, 40, y + 22)
    .text(`Generated: ${new Date().toLocaleString('en-US')}`, 40, y + 36);

  // Status badge — top right (kept; complements the stamp)
  const status = STATUS_COLORS[tx.status] || STATUS_COLORS.Completed;
  const badgeX = doc.page.width - 180, badgeY = y, badgeW = 140, badgeH = 32;
  doc.rect(badgeX, badgeY, badgeW, badgeH).fill(status.bg);
  doc.fillColor(status.fg).font('Helvetica-Bold').fontSize(11)
    .text(status.label, badgeX, badgeY + 11, { width: badgeW, align: 'center' });

  // Divider
  y += 60;
  doc.fillColor(TEXT_DARK);
  doc.strokeColor(PURPLE).lineWidth(1).moveTo(40, y).lineTo(doc.page.width - 40, y).stroke();

  // Parties section — two columns
  y += 20;
  const colW = (doc.page.width - 80 - 20) / 2;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(PURPLE)
    .text('FROM', 40, y);
  doc.font('Helvetica').fontSize(11).fillColor(TEXT_DARK)
    .text(`Client: ${tx.counterparty_name || tx.client_name || '—'}`, 40, y + 14)
    .text(`Type: ${tx.counterparty_type || '—'}`, 40, y + 30)
    .text(`Method: ${tx.payment_method || '—'}`, 40, y + 46);

  const col2X = 40 + colW + 20;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PURPLE)
    .text('PROCESSED VIA', col2X, y);
  doc.font('Helvetica').fontSize(11).fillColor(TEXT_DARK)
    .text(`Entity: ${related.entity_name || tx.company_name || '—'}`, col2X, y + 14)
    .text(`Merchant: ${related.processor_name || tx.merchant_account || '—'}`, col2X, y + 30)
    .text(`Reference: ${tx.processor_reference || tx.external_txn_id || '—'}`, col2X, y + 46);

  y += 80;

  // Financial breakdown table
  doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT_DARK)
    .text('FINANCIAL BREAKDOWN', 40, y);
  y += 18;

  const tableX = 40, tableW = doc.page.width - 80, rowH = 26;
  const grossN = parseFloat(tx.gross_amount) || 0;
  const feeN   = parseFloat(tx.fee_amount) || 0;
  const feePct = parseFloat(tx.foundapay_fee_pct) || 0;
  const procN  = parseFloat(tx.processor_fee_amount) || 0;
  const procPct = parseFloat(tx.processor_fee_pct) || 0;
  const reserveN = parseFloat(tx.reserve_amount) || 0;
  const reservePct = parseFloat(tx.reserve_pct) || 0;
  const mcN    = parseFloat(tx.merchant_charges) || 0;
  const netN   = parseFloat(tx.net_amount) || 0;

  const rows = [
    ['Gross Amount', fmtMoney(grossN), false],
    procN > 0 && [`Processor Fee (${(procPct * 100).toFixed(2)}%)`, `-${fmtMoney(procN)}`, false],
    reserveN > 0 && [`Reserve Hold (${(reservePct * 100).toFixed(2)}%)`, `-${fmtMoney(reserveN)}`, false],
    feePct > 0 && [`FoundaPay Commission (${(feePct * 100).toFixed(2)}%)`, `-${fmtMoney(feeN)}`, false],
    [`Merchant Charges${tx.bearing_merchant_charges === 'Client' ? '' : ' (FP bears)'}`, fmtMoney(mcN), false],
  ].filter(Boolean);

  rows.forEach((row, i) => {
    const ry = y + i * rowH;
    doc.rect(tableX, ry, tableW, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(10).fillColor(TEXT_DARK)
      .text(row[0], tableX + 12, ry + 9, { width: tableW * 0.6 - 12 });
    doc.font('Helvetica').fontSize(10).fillColor(TEXT_DARK)
      .text(row[1], tableX, ry + 9, { width: tableW - 12, align: 'right' });
  });
  y += rows.length * rowH;

  // Net row — purple highlight
  doc.rect(tableX, y, tableW, rowH + 6).fill(PURPLE);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(12)
    .text('NET TO CLIENT', tableX + 12, y + 11, { width: tableW * 0.6 - 12 });
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
    .text(fmtMoney(netN), tableX, y + 10, { width: tableW - 12, align: 'right' });
  y += rowH + 24;

  // Notes
  if (tx.notes && tx.notes.trim()) {
    doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(10)
      .text('NOTES', 40, y);
    y += 14;
    doc.rect(40, y, tableW, 50).fill(PURPLE_LIGHT);
    doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(10)
      .text(tx.notes.slice(0, 500), 50, y + 10, { width: tableW - 20, height: 36 });
    y += 60;
  }

  // Footer
  const footerY = doc.page.height - 60;
  doc.rect(0, footerY, doc.page.width, 60).fill(PURPLE_LIGHT);
  doc.fillColor(PURPLE_DARK).font('Helvetica').fontSize(9)
    .text('This receipt was generated by FoundaPay ERP', 40, footerY + 10, { width: doc.page.width - 80, align: 'center' })
    .text('portal.foundapay.com  |  noreply@foundapay.com', 40, footerY + 24, { width: doc.page.width - 80, align: 'center' })
    .fillColor(TEXT_MUTED).fontSize(8)
    .text(`Transaction ID: ${tx.id}  |  Generated: ${new Date().toISOString()}`, 40, footerY + 40, { width: doc.page.width - 80, align: 'center' });

  doc.end();
}

// ━━━ Statement — multiple transactions for a period ─────────
function buildStatement({ client, period, transactions, totals }, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(stream);

  // Header
  doc.rect(0, 0, doc.page.width, 80).fill(PURPLE);
  doc.fillColor('#FFFFFF').fontSize(28).font('Helvetica-Bold').text('Founda Pay', 40, 28);
  doc.fontSize(11).font('Helvetica').text('CLIENT STATEMENT', 0, 36, { width: doc.page.width - 40, align: 'right' });
  doc.fillColor(TEXT_DARK);

  let y = 110;
  doc.font('Helvetica-Bold').fontSize(16).text(client.name, 40, y);
  doc.font('Helvetica').fontSize(10).fillColor(TEXT_MUTED)
    .text(`Period: ${period.from} — ${period.to}`, 40, y + 22)
    .text(`Generated: ${new Date().toLocaleDateString('en-US')}`, 40, y + 36);

  // Summary box
  y += 70;
  const sumW = doc.page.width - 80;
  doc.rect(40, y, sumW, 90).fill(PURPLE_LIGHT);
  doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(11)
    .text('PERIOD SUMMARY', 50, y + 12);
  const stats = [
    ['Total Received', fmtMoney(totals.gross_received)],
    ['Total Commission', fmtMoney(totals.commission)],
    ['Total Reserve Held', fmtMoney(totals.reserve_held)],
    ['Total Paid Out', fmtMoney(totals.paid_out)],
  ];
  stats.forEach((s, i) => {
    const sx = 50 + (i % 2) * (sumW / 2);
    const sy = y + 32 + Math.floor(i / 2) * 26;
    doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text(s[0], sx, sy);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT_DARK).text(s[1], sx, sy + 10);
  });
  y += 110;

  // Transactions table
  doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT_DARK).text('TRANSACTIONS', 40, y);
  y += 18;

  const cols = [
    { key: 'date_received', label: 'Date',    w: 70, fmt: fmtDate },
    { key: 'id',            label: '#',       w: 40, fmt: (v) => `#${v}` },
    { key: 'payment_method',label: 'Method',  w: 80 },
    { key: 'gross_amount',  label: 'Gross',   w: 72, fmt: fmtMoney, align: 'right' },
    { key: 'fee_amount',    label: 'Comm.',   w: 65, fmt: fmtMoney, align: 'right' },
    { key: 'reserve_amount',label: 'Reserve', w: 65, fmt: fmtMoney, align: 'right' },
    { key: 'net_amount',    label: 'Net',     w: 72, fmt: fmtMoney, align: 'right' },
    { key: 'status',        label: 'Status',  w: 60 },
  ];
  // Header row
  doc.rect(40, y, doc.page.width - 80, 22).fill(PURPLE);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
  let cx = 40;
  cols.forEach((col) => {
    doc.text(col.label, cx + 4, y + 7, { width: col.w - 8, align: col.align || 'left' });
    cx += col.w;
  });
  y += 22;

  // Body rows
  doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(8);
  const PAGE_BOTTOM = doc.page.height - 80;
  transactions.forEach((tx, i) => {
    if (y > PAGE_BOTTOM) {
      doc.addPage();
      y = 40;
    }
    if (i % 2 === 1) {
      doc.rect(40, y, doc.page.width - 80, 18).fill('#F9FAFB');
      doc.fillColor(TEXT_DARK);
    }
    cx = 40;
    cols.forEach((col) => {
      const raw = tx[col.key];
      const text = col.fmt ? col.fmt(raw) : (raw == null ? '—' : String(raw));
      doc.text(text, cx + 4, y + 5, { width: col.w - 8, align: col.align || 'left', ellipsis: true });
      cx += col.w;
    });
    y += 18;
  });

  // Footer with page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(TEXT_MUTED).font('Helvetica').fontSize(8)
      .text(`portal.foundapay.com  |  Page ${i + 1} of ${range.count}`,
            40, doc.page.height - 30,
            { width: doc.page.width - 80, align: 'center' });
  }

  doc.end();
}

// ━━━ Invoice — issued to a customer, optionally paid ─────────
function buildInvoice(inv, related = {}, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(stream);

  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40; // page margin

  // ━━━ Header — brand color bar (defaults to purple if no brand color) ━━━
  // Hex colors from client_brands.brand_color override the platform purple.
  const headerColor = sanitizeHex(related.brand_color) || PURPLE;
  doc.rect(0, 0, W, 110).fill(headerColor);
  doc.rect(0, 100, W, 10).fill(PURPLE_DARK);

  // Logo (brand → entity → client) on the left
  const logoPath = resolveLogoPath(related.logo_url);
  if (logoPath) {
    try { doc.image(logoPath, M, 22, { fit: [140, 56], align: 'left', valign: 'center' }); }
    catch { /* fallback to text below */ }
  } else if (related.brand_name) {
    // Render brand name as text on the header bar when no logo
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20)
       .text(related.brand_name, M, 38, { width: 320, ellipsis: true });
  }

  // Issuer block (right side of header)
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(28)
     .text('INVOICE', M, 30, { width: W - M * 2, align: 'right' });
  doc.font('Helvetica').fontSize(11)
     .text(`#${inv.invoice_number}`, M, 64, { width: W - M * 2, align: 'right' });

  // ━━━ PAID stamp (only on paid invoices) ━━━
  const isPaid = String(inv.status || '').toLowerCase() === 'paid';
  if (isPaid) {
    drawPaidStamp(doc, { x: W - 220, y: 130 });
  }

  // ━━━ Issuer / customer parties — two columns ━━━
  let y = 130;
  const colW = (W - M * 2 - 20) / 2;
  // When a brand is set: brand is the primary issuer, entity gets a
  // "Processed by ENTITY" subtitle. Otherwise fall through to entity → client.
  const issuerName = related.brand_name || related.entity_name || related.client_name || 'FoundaPay';

  doc.fillColor(PURPLE).font('Helvetica-Bold').fontSize(9).text('FROM', M, y);
  doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(13).text(issuerName, M, y + 14);
  doc.font('Helvetica').fontSize(10).fillColor(TEXT_MUTED);
  let yi = y + 32;
  if (related.brand_name && related.entity_name && related.brand_name !== related.entity_name) {
    doc.fillColor(TEXT_MUTED).fontSize(9)
       .text(`Processed by ${related.entity_name}`, M, yi, { width: colW });
    yi += 14;
  }
  if (related.brand_support_email) { doc.text(related.brand_support_email, M, yi); yi += 14; }
  else if (related.entity_email)   { doc.text(related.entity_email, M, yi);        yi += 14; }
  if (related.brand_support_phone) { doc.text(related.brand_support_phone, M, yi); yi += 14; }
  else if (related.entity_phone)   { doc.text(related.entity_phone, M, yi);        yi += 14; }
  if (related.entity_address) {
    doc.text(String(related.entity_address).slice(0, 200), M, yi, { width: colW });
    yi += 28;
  }

  const col2X = M + colW + 20;
  doc.fillColor(PURPLE).font('Helvetica-Bold').fontSize(9).text('BILL TO', col2X, y);
  doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(13)
     .text(inv.customer_name || '—', col2X, y + 14);
  doc.font('Helvetica').fontSize(10).fillColor(TEXT_MUTED);
  let yc = y + 32;
  if (inv.customer_email)   { doc.text(inv.customer_email, col2X, yc, { width: colW });   yc += 14; }
  if (inv.customer_phone)   { doc.text(inv.customer_phone, col2X, yc, { width: colW });   yc += 14; }
  if (inv.customer_address) { doc.text(String(inv.customer_address).slice(0, 200), col2X, yc, { width: colW }); yc += 28; }

  // ━━━ Invoice meta strip ━━━
  y = Math.max(yi, yc) + 18;
  doc.rect(M, y, W - M * 2, 50).fill(PURPLE_LIGHT);
  doc.fillColor(TEXT_MUTED).font('Helvetica-Bold').fontSize(9);
  const metaW = (W - M * 2) / 4;
  doc.text('ISSUE DATE', M + 12, y + 10);
  doc.text('DUE DATE',   M + 12 + metaW, y + 10);
  doc.text('STATUS',     M + 12 + metaW * 2, y + 10);
  doc.text('AMOUNT DUE', M + 12 + metaW * 3, y + 10);
  doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(12);
  doc.text(fmtDate(inv.issue_date), M + 12, y + 26);
  doc.text(inv.due_date ? fmtDate(inv.due_date) : '—', M + 12 + metaW, y + 26);
  const statusLabel = isPaid ? 'PAID' : String(inv.status || 'DRAFT').toUpperCase();
  doc.fillColor(isPaid ? PAID_GREEN : PURPLE_DARK)
     .text(statusLabel, M + 12 + metaW * 2, y + 26);
  doc.fillColor(TEXT_DARK)
     .text(fmtMoney(inv.total_amount), M + 12 + metaW * 3, y + 26);

  // ━━━ Line items table ━━━
  y += 70;
  const tableX = M, tableW = W - M * 2;
  const colDesc = tableW * 0.55;
  const colQty  = tableW * 0.10;
  const colPrice = tableW * 0.15;
  const colTotal = tableW * 0.20;

  // Header row
  doc.rect(tableX, y, tableW, 28).fill(PURPLE);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
  doc.text('DESCRIPTION', tableX + 12, y + 10, { width: colDesc - 12 });
  doc.text('QTY',         tableX + colDesc, y + 10, { width: colQty, align: 'right' });
  doc.text('UNIT PRICE',  tableX + colDesc + colQty, y + 10, { width: colPrice - 8, align: 'right' });
  doc.text('LINE TOTAL',  tableX + colDesc + colQty + colPrice, y + 10, { width: colTotal - 12, align: 'right' });
  y += 28;

  // Body rows
  let lineItems = inv.line_items || [];
  if (typeof lineItems === 'string') {
    try { lineItems = JSON.parse(lineItems); } catch { lineItems = []; }
  }
  doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(10);
  const ROW_H = 28;
  lineItems.forEach((li, i) => {
    const ry = y;
    if (i % 2 === 1) {
      doc.rect(tableX, ry, tableW, ROW_H).fill('#FAFAFA');
      doc.fillColor(TEXT_DARK);
    }
    doc.font('Helvetica').fontSize(10).fillColor(TEXT_DARK);
    doc.text(String(li.description || '').slice(0, 100), tableX + 12, ry + 9, { width: colDesc - 12, ellipsis: true });
    doc.text(String(li.quantity ?? '—'), tableX + colDesc, ry + 9, { width: colQty, align: 'right' });
    doc.text(fmtMoney(li.unit_price), tableX + colDesc + colQty, ry + 9, { width: colPrice - 8, align: 'right' });
    doc.text(fmtMoney(li.line_total), tableX + colDesc + colQty + colPrice, ry + 9, { width: colTotal - 12, align: 'right' });
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(tableX, ry + ROW_H).lineTo(tableX + tableW, ry + ROW_H).stroke();
    y += ROW_H;
  });

  // ━━━ Totals block (right-aligned) ━━━
  y += 8;
  const totalsX = tableX + tableW * 0.55;
  const totalsW = tableW * 0.45;
  function totalRow(label, value, opts = {}) {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 10)
       .fillColor(opts.color || TEXT_DARK);
    doc.text(label, totalsX, y, { width: totalsW * 0.55, align: 'right' });
    doc.text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45 - 12, align: 'right' });
    y += opts.bold ? 18 : 16;
  }
  totalRow('Subtotal',       fmtMoney(inv.subtotal));
  if (parseFloat(inv.discount_amount) > 0) totalRow('Discount', `-${fmtMoney(inv.discount_amount)}`);
  if (parseFloat(inv.tax_rate) > 0) {
    totalRow(`Tax (${(parseFloat(inv.tax_rate) * 100).toFixed(2)}%)`, fmtMoney(inv.tax_amount));
  }
  // Grand total — purple highlight
  doc.rect(totalsX, y, totalsW, 32).fill(PURPLE);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11)
     .text('TOTAL DUE', totalsX, y + 11, { width: totalsW * 0.55, align: 'right' });
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
     .text(fmtMoney(inv.total_amount), totalsX + totalsW * 0.55, y + 10, { width: totalsW * 0.45 - 12, align: 'right' });
  y += 40;

  // ━━━ Pay link / payment instructions ━━━
  if (inv.payment_link_url && !isPaid) {
    doc.rect(M, y, tableW, 60).fill(PURPLE_LIGHT);
    doc.fillColor(PURPLE_DARK).font('Helvetica-Bold').fontSize(11)
       .text('PAY ONLINE', M + 16, y + 12);
    doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(10)
       .text(inv.payment_link_url, M + 16, y + 32, { width: tableW - 32, ellipsis: true });
    y += 70;
  }

  // ━━━ Notes ━━━
  if (inv.notes && inv.notes.trim()) {
    doc.fillColor(TEXT_MUTED).font('Helvetica-Bold').fontSize(9).text('NOTES', M, y);
    doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(10)
       .text(String(inv.notes).slice(0, 800), M, y + 14, { width: tableW });
    y += 60;
  }

  // ━━━ Statement-descriptor callout (chargeback mitigation) ━━━
  // Sets the customer's expectation: "your card statement will read
  // BRAND*DESCRIPTOR" so they don't dispute the charge as unrecognized.
  if (related.brand_descriptor || related.brand_descriptor_note) {
    const boxH = 50;
    doc.rect(M, y, tableW, boxH).fill('#FFF7ED'); // soft-amber background
    doc.fillColor('#9A3412').font('Helvetica-Bold').fontSize(9)
       .text('STATEMENT DESCRIPTOR', M + 12, y + 10);
    if (related.brand_descriptor) {
      doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(11)
         .text(`Charge appears as ${related.brand_descriptor}`, M + 12, y + 22);
    }
    if (related.brand_descriptor_note) {
      doc.fillColor(TEXT_MUTED).font('Helvetica').fontSize(9)
         .text(String(related.brand_descriptor_note).slice(0, 200),
               M + 12, y + 34, { width: tableW - 24 });
    }
    y += boxH + 8;
  }

  // ━━━ Footer ━━━
  const footerY = H - 60;
  doc.rect(0, footerY, W, 60).fill(PURPLE_LIGHT);
  doc.fillColor(PURPLE_DARK).font('Helvetica').fontSize(9)
     .text(inv.footer_text || 'Thank you for your business.', M, footerY + 14, { width: W - M * 2, align: 'center' });
  doc.fillColor(TEXT_MUTED).fontSize(8)
     .text(`Generated by FoundaPay  |  portal.foundapay.com  |  ${new Date().toISOString()}`,
           M, footerY + 36, { width: W - M * 2, align: 'center' });

  doc.end();
}

// Lenient hex sanitizer — accepts #RGB / #RRGGBB / #RRGGBBAA. Rejects
// anything else so we never feed PDFKit a bad color string.
function sanitizeHex(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  return m ? `#${m[1]}` : null;
}

module.exports = { buildReceipt, buildStatement, buildInvoice };
