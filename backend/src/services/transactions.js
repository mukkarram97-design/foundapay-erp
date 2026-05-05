// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Transactions service — single source of truth for INSERT INTO
// transactions. All payment-record creation goes through here.
//
// Schema-aware: uses ACTUAL column names in this DB (not the
// master plan names). Mappings for caller convenience:
//   master plan name   →  actual column
//   ────────────────────────────────────
//   fee_pct            →  foundapay_fee_pct
//   fp_fee             →  fee_amount
//   reserve            →  reserve_amount
//   authnet_tx_id      →  external_txn_id
//   authnet_auth_code  →  processor_reference
//   gross              →  gross_amount
//   net                →  net_amount
//
// New columns (added in 005 migration): card_last4, card_brand,
// customer_email, customer_name, source, failure_code, failure_message,
// failure_response_raw (jsonb), avs_result, cvv_result.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { pool } = require('../db');

/**
 * Insert a row into transactions and return its id.
 *
 * Caller passes a checked-out pg client to participate in an open
 * BEGIN/COMMIT block, or null to use the default pool (non-transactional).
 *
 * Throws on DB error. The caller decides whether to roll back its
 * transaction or surface the error to the user. NEVER swallows errors.
 *
 * @returns {Promise<{ id: number }>}
 */
async function recordTransaction(client, fields) {
  const {
    // Required
    amount,                              // gross
    // Common
    type = 'Received',
    date_received = new Date().toISOString().slice(0, 10),
    clientId = null,
    counterpartyType = 'Client',
    counterpartyName = null,
    entityId = null,
    merchantId = null,
    paymentMethod = 'Debit/Credit Cards',
    companyName = null,
    merchantAccount = null,
    // Settlement breakdown
    feePct = 0,                          // foundapay_fee_pct (decimal e.g. 0.30)
    feeAmount = 0,                       // fp_fee in master plan
    reservePct = 0,
    reserveAmount = 0,
    merchantCharges = 0,
    bearingMerchantCharges = 'Client',
    netAmount = null,                    // null → computed = gross − fee − reserve − (mc if Client-borne)
    fundsAvailableDate = null,
    // Processor
    externalTxnId = null,                // master plan: authnet_transaction_id
    processorReference = null,           // master plan: authnet_auth_code
    cardLast4 = null,
    cardBrand = null,
    avsResult = null,
    cvvResult = null,
    // Customer
    customerEmail = null,
    customerName = null,
    // Status / source
    status = 'Completed',
    source = null,                       // 'virtual_terminal' | 'payment_link' | 'manual' | 'imported'
    paymentLinkId = null,
    // Failure detail
    failureCode = null,
    failureMessage = null,
    failureResponseRaw = null,           // any JS object — JSON.stringify'd into JSONB
    // Audit
    createdByUserId = null,
    approvedBy = null,
    notes = null,
  } = fields || {};

  if (amount == null || !isFinite(parseFloat(amount)) || parseFloat(amount) < 0) {
    throw new Error('recordTransaction: amount is required and must be ≥ 0');
  }

  const grossN   = parseFloat(amount);
  const feeAmtN  = parseFloat(feeAmount) || 0;
  const reserveN = parseFloat(reserveAmount) || 0;
  const mcN      = parseFloat(merchantCharges) || 0;
  const netN = netAmount != null
    ? parseFloat(netAmount)
    : grossN - feeAmtN - reserveN - (bearingMerchantCharges === 'Client' ? mcN : 0);

  const sql = `
    INSERT INTO transactions
      (type, date_received,
       client_id, counterparty_type, counterparty_name,
       entity_id, merchant_id,
       payment_method, company_name, merchant_account,
       gross_amount, foundapay_fee_pct, fee_amount,
       merchant_charges, bearing_merchant_charges,
       net_amount, funds_available_date,
       reserve_pct, reserve_amount,
       status, external_txn_id, processor_reference,
       payment_link_id,
       card_last4, card_brand,
       customer_email, customer_name,
       source,
       avs_result, cvv_result,
       failure_code, failure_message, failure_response_raw,
       notes, created_by, approved_by, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
       $33::jsonb, $34,$35,$36, NOW())
    RETURNING id
  `;

  const params = [
    type, date_received,
    clientId, counterpartyType, counterpartyName,
    entityId, merchantId,
    paymentMethod, companyName, merchantAccount,
    grossN, feePct, feeAmtN,
    mcN, bearingMerchantCharges,
    netN, fundsAvailableDate,
    reservePct, reserveN,
    status, externalTxnId, processorReference,
    paymentLinkId,
    cardLast4 ? String(cardLast4).slice(-4) : null,
    cardBrand,
    customerEmail, customerName,
    source,
    avsResult, cvvResult,
    failureCode, failureMessage,
    failureResponseRaw == null ? null : JSON.stringify(failureResponseRaw),
    notes, createdByUserId, approvedBy,
  ];

  const exec = client || pool;
  const r = await exec.query(sql, params);
  return { id: r.rows[0].id };
}

module.exports = { recordTransaction };
