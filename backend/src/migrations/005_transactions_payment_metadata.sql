-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 005 — Transactions: payment metadata + source enum + 3-row backfill
--
-- Additive only. Idempotent. Touches ONE existing table: transactions.
--   - 10 new nullable columns
--   - 1 new CHECK constraint (transactions_source_check)
--   - 2 new indexes
--   - 1 one-time backfill (self-healing — re-running is a no-op)
--
-- Existing columns we already use (NOT duplicated):
--   external_txn_id      ← Authorize.net transactionId
--   processor_reference  ← Authorize.net authCode
--   foundapay_fee_pct, fee_amount, reserve_amount,
--   gross_amount, net_amount, merchant_charges,
--   payment_method, payment_link_id   (all already present)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Add columns
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS card_last4           VARCHAR(4);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS card_brand           VARCHAR(20);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS customer_email       VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS customer_name        VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source               VARCHAR(30);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS failure_code         TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS failure_message      TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS failure_response_raw JSONB;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS avs_result           CHAR(1);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cvv_result           CHAR(1);

-- 2. CHECK on source (drop+add → idempotent)
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_source_check
  CHECK (source IS NULL OR source IN ('virtual_terminal','payment_link','manual','imported'));

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_tx_source           ON transactions(source);
CREATE INDEX IF NOT EXISTS idx_tx_payment_link_id  ON transactions(payment_link_id) WHERE payment_link_id IS NOT NULL;

-- 4. ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--    ONE-TIME BACKFILL — self-healing (no-op on re-run because
--    the WHERE clause filters out rows already linked).
--
--    Imports vt_transactions(status='success', transaction_id IS NULL)
--    rows into the master ledger and back-links them.
--
--    Caveat: legacy public-pay rows have client_id=NULL. Master
--    Ledger will show them as "anonymous" until ops manually re-links.
--    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WITH backfill AS (
  SELECT id, processor_transaction_id, processor_auth_code,
         card_last4, card_type, card_holder_name, customer_email,
         amount, invoice_number, description, brand_name,
         client_id, entity_id, created_at
    FROM vt_transactions
   WHERE status = 'success'
     AND transaction_id IS NULL
), inserted AS (
  INSERT INTO transactions
    (type, date_received, client_id, counterparty_type, counterparty_name,
     entity_id, payment_method, gross_amount,
     foundapay_fee_pct, fee_amount, net_amount,
     status, external_txn_id, processor_reference,
     card_last4, card_brand, customer_email, customer_name,
     source, notes, created_at, updated_at)
  SELECT
    'Received', b.created_at::date, b.client_id, 'Client',
    COALESCE(b.card_holder_name, b.customer_email, 'Backfilled — payment_link'),
    b.entity_id, 'Debit/Credit Cards',
    b.amount,
    0, 0, b.amount,                              -- fee/net pending manual reconciliation
    'Completed', b.processor_transaction_id, b.processor_auth_code,
    b.card_last4, b.card_type, b.customer_email, b.card_holder_name,
    'payment_link',
    'BACKFILL: imported from vt_transactions on ' || NOW()::text
      || ' | inv:' || COALESCE(b.invoice_number,'')
      || ' | brand:' || COALESCE(b.brand_name,''),
    b.created_at, NOW()
  FROM backfill b
  RETURNING id, external_txn_id  -- == vt processor_transaction_id, used to re-join
)
UPDATE vt_transactions vt
   SET transaction_id = i.id
  FROM inserted i
 WHERE vt.processor_transaction_id = i.external_txn_id
   AND vt.transaction_id IS NULL;

-- ━━━ ROLLBACK (commented; manual only) ━━━
-- The backfill UPDATE/INSERT is irreversible without pg_dump restore.
-- ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
-- DROP INDEX IF EXISTS idx_tx_payment_link_id;
-- DROP INDEX IF EXISTS idx_tx_source;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS cvv_result;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS avs_result;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS failure_response_raw;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS failure_message;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS failure_code;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS source;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS customer_name;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS customer_email;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS card_brand;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS card_last4;
