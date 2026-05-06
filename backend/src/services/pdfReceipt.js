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

module.exports = { buildReceipt, buildStatement };
