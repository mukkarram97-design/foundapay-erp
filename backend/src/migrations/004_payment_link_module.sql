-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 004 — Payment Links module: schema reconciliation + new columns
--
-- Additive only. Safe to re-run (idempotent).
-- Touches ONE existing table: payment_link_requests.
--   - Adds 5 columns IF NOT EXISTS (token, expires_at, attempts, last_error, paid_at)
--   - Adds 1 UNIQUE constraint on token (guarded by pg_constraint check)
--   - Replaces the status CHECK constraint to allow new values 'pending' and
--     'expired' alongside all 11 existing values (no data remapping)
--   - Adds 7 indexes IF NOT EXISTS for filter performance
--   - Nullifies stored processor_link URLs (BETTER FIX — see PR review)
--
-- Decisions baked in (per PR review on 2026-05-05):
--   - User FK column stays as `created_by` (the existing column name).
--     We index on `created_by`, NOT `created_by_user_id` (which doesn't exist
--     in this database). New backend code already adapted.
--   - Status CHECK is RELAXED — existing rows keep their current status;
--     new values 'pending' and 'expired' are allowed for new rows.
--   - processor_link cleanup nullifies every row so we never read a stale
--     URL again. New code computes URL as `${PORTAL_URL}/pay/${token}` on read.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ━━━ 1. Add new columns (additive) ━━━
ALTER TABLE payment_link_requests
  ADD COLUMN IF NOT EXISTS token UUID DEFAULT uuid_generate_v4();

ALTER TABLE payment_link_requests
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE payment_link_requests
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payment_link_requests
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE payment_link_requests
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Belt-and-suspenders: in case a previous failed migration added the column
-- without firing the volatile default, ensure no NULL tokens remain.
UPDATE payment_link_requests
   SET token = uuid_generate_v4()
 WHERE token IS NULL;

-- Backfill expires_at on legacy rows (30 days from creation by default).
UPDATE payment_link_requests
   SET expires_at = COALESCE(created_at, NOW()) + INTERVAL '30 days'
 WHERE expires_at IS NULL;

-- ━━━ 2. UNIQUE constraint on token ━━━
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_link_requests_token_key'
       AND conrelid = 'payment_link_requests'::regclass
  ) THEN
    ALTER TABLE payment_link_requests
      ADD CONSTRAINT payment_link_requests_token_key UNIQUE (token);
  END IF;
END $$;

-- ━━━ 3. Relax status CHECK to allow 'pending' and 'expired' ━━━
-- All 11 existing values preserved. No data remapping.
ALTER TABLE payment_link_requests
  DROP CONSTRAINT IF EXISTS payment_link_requests_status_check;

ALTER TABLE payment_link_requests
  ADD CONSTRAINT payment_link_requests_status_check
  CHECK (status IN (
    'requested','assigned','merchant_selected','link_generated',
    'sent_to_client','sent_to_customer','waiting_payment',
    'paid','failed','cancelled','refunded',
    'pending','expired'
  ));

-- ━━━ 4. Indexes for filter performance ━━━
CREATE INDEX IF NOT EXISTS idx_plr_token            ON payment_link_requests(token);
CREATE INDEX IF NOT EXISTS idx_plr_status           ON payment_link_requests(status);
CREATE INDEX IF NOT EXISTS idx_plr_client           ON payment_link_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_plr_created_by       ON payment_link_requests(created_by);
CREATE INDEX IF NOT EXISTS idx_plr_created_at       ON payment_link_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plr_customer_email   ON payment_link_requests(customer_email);
CREATE INDEX IF NOT EXISTS idx_plr_expires_pending  ON payment_link_requests(expires_at)
  WHERE status NOT IN ('paid','cancelled','failed','refunded','expired');

-- ━━━ 5. BETTER-FIX cleanup: nullify stored legacy URLs ━━━
-- New code reads URL from token + PORTAL_URL; stored URL is no longer trusted.
-- This is irreversible from this script — the pre-migration pg_dump backup
-- is your fallback if you need to recover original URLs.
UPDATE payment_link_requests
   SET processor_link = NULL
 WHERE processor_link IS NOT NULL;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ROLLBACK / DOWN — uncomment and run manually only if needed.
-- The processor_link nullification cannot be undone by this block; restore
-- from /tmp/foundapay_backup_<ts>.sql created before this migration ran.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ALTER TABLE payment_link_requests
--   DROP CONSTRAINT IF EXISTS payment_link_requests_status_check;
-- ALTER TABLE payment_link_requests
--   ADD CONSTRAINT payment_link_requests_status_check
--   CHECK (status IN ('requested','assigned','merchant_selected','link_generated',
--                     'sent_to_client','sent_to_customer','waiting_payment',
--                     'paid','failed','cancelled','refunded'));
-- DROP INDEX IF EXISTS idx_plr_expires_pending;
-- DROP INDEX IF EXISTS idx_plr_customer_email;
-- DROP INDEX IF EXISTS idx_plr_created_at;
-- DROP INDEX IF EXISTS idx_plr_created_by;
-- DROP INDEX IF EXISTS idx_plr_client;
-- DROP INDEX IF EXISTS idx_plr_status;
-- DROP INDEX IF EXISTS idx_plr_token;
-- ALTER TABLE payment_link_requests
--   DROP CONSTRAINT IF EXISTS payment_link_requests_token_key;
-- ALTER TABLE payment_link_requests DROP COLUMN IF EXISTS paid_at;
-- ALTER TABLE payment_link_requests DROP COLUMN IF EXISTS last_error;
-- ALTER TABLE payment_link_requests DROP COLUMN IF EXISTS attempts;
-- ALTER TABLE payment_link_requests DROP COLUMN IF EXISTS expires_at;
-- ALTER TABLE payment_link_requests DROP COLUMN IF EXISTS token;
