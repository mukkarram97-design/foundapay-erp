// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Transaction calc engine — auto-commission, net, reserve rules
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const METHOD_RATE_MAP = {
  'Debit/Credit Cards': 'card_pct',
  'Card': 'card_pct',
  'Cards': 'card_pct',
  'Wire Transfer': 'wire_pct',
  'Wire': 'wire_pct',
  'Cheque': 'cheque_pct',
  'Check': 'cheque_pct',
  'ACH': 'ach_pct',
  'Zelle': 'zelle_pct',
};

function autoLookupCommissionPct(client, paymentMethod) {
  if (!client || !paymentMethod) return 0;
  const field = METHOD_RATE_MAP[paymentMethod];
  if (!field) return 0;
  return parseFloat(client[field]) || 0;
}

function calculateNet(input) {
  const gross = parseFloat(input.gross_amount) || 0;
  const procFeePct = parseFloat(input.processor_fee_pct) || 0;
  const procFixed = parseFloat(input.processor_fixed_fee) || 0;
  const reservePct = parseFloat(input.reserve_pct) || 0;
  const commissionPct = parseFloat(input.foundapay_fee_pct) || 0;
  const merchantCharges = parseFloat(input.merchant_charges) || 0;

  const procFee = gross * procFeePct + procFixed;
  const reserveAmount = gross * reservePct;
  const commission = gross * commissionPct;

  let net = gross;
  if ((input.processor_fee_bearer || 'Client') !== 'FoundaPay') net -= procFee;
  if ((input.reserve_bearer || 'Client') !== 'FoundaPay') net -= reserveAmount;
  net -= commission;
  if ((input.bearing_merchant_charges || 'Client') === 'Client') net -= merchantCharges;

  return {
    gross: round4(gross),
    fee_amount: round4(commission),
    processor_fee_amount: round4(procFee),
    reserve_amount: round4(reserveAmount),
    merchant_charges: round4(merchantCharges),
    net_amount: round4(net),
  };
}

function round4(n) {
  return parseFloat(Number(n).toFixed(4));
}

// Reserve rules per client
const RESERVE_RULES = {
  'DND':      { pct: 0.10, basis: 'gross',          label: '10% of Gross' },
  'Azeem':    { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross - Merchant Charges)' },
  'Husk SOL': { pct: 0.10, basis: 'gross_minus_mc', label: '10% of (Gross - Merchant Charges)' },
};

function getReserveRule(clientName) {
  return RESERVE_RULES[clientName] || null;
}

function applyReserveRule(clientName, gross, merchantCharges) {
  const rule = getReserveRule(clientName);
  if (!rule) return null;
  const base = rule.basis === 'gross' ? gross : (gross - (merchantCharges || 0));
  return {
    pct: rule.pct,
    amount: round4(base * rule.pct),
    label: rule.label,
  };
}

// Default: today + 3 business days
function defaultFundsAvailableDate(fromDate) {
  const d = fromDate ? new Date(fromDate) : new Date();
  let added = 0;
  while (added < 3) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

module.exports = {
  METHOD_RATE_MAP,
  autoLookupCommissionPct,
  calculateNet,
  getReserveRule,
  applyReserveRule,
  defaultFundsAvailableDate,
  RESERVE_RULES,
};
