// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PDF report builders. Each consumes a stream and a data shape.
// Used by routes/reports.js when ?format=pdf.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PDFDocument = require('pdfkit');

const PURPLE = '#7C3AED';
const PURPLE_DARK = '#5B21B6';
const PURPLE_LIGHT = '#EDE9FE';
const TEXT_DARK = '#1A1027';
const TEXT_MUTED = '#6B7280';
const BORDER = '#E5E7EB';

function fmtMoney(n) {
  const v = parseFloat(n) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function header(doc, title, period) {
  doc.rect(0, 0, doc.page.width, 70).fill(PURPLE);
  doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text('Founda Pay', 40, 22);
  doc.fontSize(11).font('Helvetica').text(title.toUpperCase(), 0, 30, { width: doc.page.width - 40, align: 'right' });
  if (period) {
    doc.fontSize(9).text(period, 0, 46, { width: doc.page.width - 40, align: 'right' });
  }
  doc.fillColor(TEXT_DARK);
}

function pageFooter(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(TEXT_MUTED).font('Helvetica').fontSize(8)
      .text(`portal.foundapay.com  |  Page ${i + 1} of ${range.count}  |  Generated ${new Date().toLocaleString()}`,
        40, doc.page.height - 28, { width: doc.page.width - 80, align: 'center' });
  }
}

function tableHeader(doc, y, cols) {
  doc.rect(40, y, doc.page.width - 80, 22).fill(PURPLE);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
  let cx = 40;
  cols.forEach((c) => {
    doc.text(c.label, cx + 4, y + 7, { width: c.w - 8, align: c.align || 'left' });
    cx += c.w;
  });
}

function tableBody(doc, y, cols, rows) {
  doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(8);
  const rowH = 18;
  const PAGE_BOTTOM = doc.page.height - 60;
  rows.forEach((r, i) => {
    if (y > PAGE_BOTTOM) {
      doc.addPage();
      y = 40;
    }
    if (i % 2 === 1) {
      doc.rect(40, y, doc.page.width - 80, rowH).fill('#F9FAFB');
      doc.fillColor(TEXT_DARK);
    }
    let cx = 40;
    cols.forEach((c) => {
      const raw = r[c.key];
      const text = c.fmt ? c.fmt(raw) : (raw == null ? '—' : String(raw));
      doc.text(text, cx + 4, y + 5, { width: c.w - 8, align: c.align || 'left', ellipsis: true });
      cx += c.w;
    });
    y += rowH;
  });
  return y;
}

// ━━━ Revenue summary ━━━
function buildRevenueSummary({ from, to, groupBy, totals, byPeriod, byClient, byMethod }, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  doc.pipe(stream);
  header(doc, 'Revenue Summary', `${from || '—'} → ${to || '—'}`);

  let y = 90;
  doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(13).text('Period totals', 40, y);
  y += 22;
  doc.rect(40, y, doc.page.width - 80, 70).fill(PURPLE_LIGHT);
  const pad = 14;
  doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED);
  doc.text('GROSS VOLUME', 40 + pad, y + 12);
  doc.text('FP REVENUE', 40 + pad + 180, y + 12);
  doc.text('NET TO CLIENTS', 40 + pad + 340, y + 12);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(TEXT_DARK);
  doc.text(fmtMoney(totals.gross), 40 + pad, y + 30);
  doc.text(fmtMoney(totals.revenue), 40 + pad + 180, y + 30);
  doc.text(fmtMoney(totals.net), 40 + pad + 340, y + 30);
  doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED);
  doc.text(`${totals.tx_count || 0} transactions`, 40 + pad, y + 52);

  y += 90;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_DARK).text(`By ${groupBy || 'period'}`, 40, y);
  y += 18;
  const cols = [
    { key: 'period', label: 'PERIOD', w: 130 },
    { key: 'gross',  label: 'GROSS',  w: 120, fmt: fmtMoney, align: 'right' },
    { key: 'revenue', label: 'REVENUE', w: 120, fmt: fmtMoney, align: 'right' },
    { key: 'net',    label: 'NET',    w: 120, fmt: fmtMoney, align: 'right' },
    { key: 'tx_count', label: '#',    w: 50, align: 'right' },
  ];
  tableHeader(doc, y, cols);
  y = tableBody(doc, y + 22, cols, byPeriod || []);

  if (byClient?.length) {
    y += 16;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_DARK).text('By client', 40, y);
    y += 18;
    const cc = [
      { key: 'client_name', label: 'CLIENT', w: 220 },
      { key: 'gross',   label: 'GROSS',   w: 120, fmt: fmtMoney, align: 'right' },
      { key: 'revenue', label: 'REVENUE', w: 120, fmt: fmtMoney, align: 'right' },
      { key: 'tx_count', label: '#',      w: 80, align: 'right' },
    ];
    tableHeader(doc, y, cc);
    y = tableBody(doc, y + 22, cc, byClient);
  }
  if (byMethod?.length) {
    y += 16;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_DARK).text('By payment method', 40, y);
    y += 18;
    const mc = [
      { key: 'payment_method', label: 'METHOD', w: 220 },
      { key: 'gross',   label: 'GROSS',   w: 120, fmt: fmtMoney, align: 'right' },
      { key: 'revenue', label: 'REVENUE', w: 120, fmt: fmtMoney, align: 'right' },
      { key: 'tx_count', label: '#',      w: 80, align: 'right' },
    ];
    tableHeader(doc, y, mc);
    y = tableBody(doc, y + 22, mc, byMethod);
  }

  pageFooter(doc);
  doc.end();
}

// ━━━ Payout reconciliation ━━━
function buildPayoutReconciliation({ from, to, client, totals, transactions, payouts }, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  doc.pipe(stream);
  header(doc, 'Payout Reconciliation', `${from || '—'} → ${to || '—'}${client?.name ? ` · ${client.name}` : ''}`);
  let y = 90;

  doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_DARK).text('Reconciliation summary', 40, y);
  y += 22;
  doc.rect(40, y, doc.page.width - 80, 84).fill(PURPLE_LIGHT);
  const stats = [
    ['Received', fmtMoney(totals.received)],
    ['Paid out', fmtMoney(totals.paid_out)],
    ['In reserve', fmtMoney(totals.reserve_held)],
    ['Pending payout', fmtMoney(totals.pending)],
  ];
  stats.forEach((s, i) => {
    const sx = 50 + (i % 2) * ((doc.page.width - 80) / 2);
    const sy = y + 12 + Math.floor(i / 2) * 32;
    doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text(s[0], sx, sy);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_DARK).text(s[1], sx, sy + 12);
  });
  y += 100;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXT_DARK).text('Payouts', 40, y);
  y += 18;
  const cols = [
    { key: 'created_at', label: 'DATE',   w: 90, fmt: fmtDate },
    { key: 'amount',     label: 'AMOUNT', w: 100, fmt: fmtMoney, align: 'right' },
    { key: 'payout_method', label: 'METHOD', w: 110 },
    { key: 'reference_number', label: 'REF', w: 140 },
    { key: 'status',     label: 'STATUS', w: 80 },
  ];
  tableHeader(doc, y, cols);
  y = tableBody(doc, y + 22, cols, payouts || []);

  pageFooter(doc);
  doc.end();
}

// ━━━ Tax summary (US-style: gross income, deductions, net taxable) ━━━
function buildTaxSummary({ from, to, totals, expensesByCat }, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  doc.pipe(stream);
  header(doc, 'Tax Summary', `${from || '—'} → ${to || '—'}`);
  let y = 90;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_DARK).text('Tax-relevant totals', 40, y);
  y += 22;
  const rows = [
    ['Gross income (commission + reserves released)', fmtMoney(totals.gross_income)],
    ['Less: deductible expenses', `-${fmtMoney(totals.deductible_expenses)}`],
    ['Less: processor + chargeback fees borne', `-${fmtMoney(totals.fees_borne)}`],
    ['Net taxable income', fmtMoney(totals.net_taxable)],
  ];
  const rowH = 26;
  rows.forEach((r, i) => {
    doc.rect(40, y, doc.page.width - 80, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.font(i === rows.length - 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(TEXT_DARK)
       .text(r[0], 52, y + 9, { width: 320 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(i === rows.length - 1 ? PURPLE : TEXT_DARK)
       .text(r[1], 40, y + 9, { width: doc.page.width - 80 - 12, align: 'right' });
    y += rowH;
  });

  if (expensesByCat?.length) {
    y += 16;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXT_DARK).text('Expenses by category', 40, y);
    y += 18;
    const ec = [
      { key: 'category', label: 'CATEGORY', w: 240 },
      { key: 'total',    label: 'AMOUNT',  w: 200, fmt: fmtMoney, align: 'right' },
    ];
    tableHeader(doc, y, ec);
    y = tableBody(doc, y + 22, ec, expensesByCat);
  }

  pageFooter(doc);
  doc.end();
}

module.exports = { buildRevenueSummary, buildPayoutReconciliation, buildTaxSummary };
