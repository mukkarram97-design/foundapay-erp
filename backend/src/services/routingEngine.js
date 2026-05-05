// Score a merchant for routing a transaction.
// Higher score = better candidate. -1 = ineligible.
function scoreMerchant(m, amount, method) {
  if (m.availability !== 'available') return -1;
  if (m.daily_limit && amount > m.daily_limit) return -1;
  if (m.monthly_limit && (m.current_month_volume || 0) / m.monthly_limit > 0.95) return -1;

  let score = 100;
  if (m.risk_status === 'high_risk') score -= 40;
  if (m.risk_status === 'elevated') score -= 20;
  score -= (parseFloat(m.chargeback_rate) || 0) * 100 * 15;
  score -= (parseFloat(m.processing_fee_pct) || 0) * 100 * 2;

  if (m.monthly_limit && (m.current_month_volume || 0) / m.monthly_limit > 0.8) score -= 25;
  if (m.supported_methods && method && Array.isArray(m.supported_methods) && !m.supported_methods.includes(method)) {
    score -= 30;
  }
  return Math.round(score * 100) / 100;
}

function rankMerchants(merchants, amount, method) {
  return merchants
    .map((m) => ({ ...m, _score: scoreMerchant(m, amount, method) }))
    .filter((m) => m._score >= 0)
    .sort((a, b) => b._score - a._score);
}

module.exports = { scoreMerchant, rankMerchants };
