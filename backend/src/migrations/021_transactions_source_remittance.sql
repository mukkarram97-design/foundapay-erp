-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 021 — Allow source='remittance' on transactions.
-- Cause: routes/wise.js writes a transactions row with source='remittance'
-- when a Wise transfer or manual wire is created. The pre-existing CHECK
-- only allowed virtual_terminal | payment_link | manual | imported, so the
-- INSERT failed with "violates check constraint transactions_source_check".
--
-- This migration drops the old constraint and replaces it with one that
-- includes 'remittance'. All existing values remain valid.
-- Idempotent — safe to re-apply.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_source_check
  CHECK (
    source IS NULL OR source IN (
      'virtual_terminal',
      'payment_link',
      'manual',
      'imported',
      'remittance'
    )
  );
