-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 022 — Real-time Wise transfer tracking columns.
-- Additive + idempotent. wise_status, completed_at, estimated_delivery,
-- wise_receipt_url already exist from migration 016 — re-add via IF NOT EXISTS
-- so this remains safe to re-run.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE remittances ADD COLUMN IF NOT EXISTS wise_status        VARCHAR(50);
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS wise_tracking_url  TEXT;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS wise_receipt_url   TEXT;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS funded_at          TIMESTAMPTZ;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS completed_at       TIMESTAMPTZ;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS failed_at          TIMESTAMPTZ;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS failure_reason     TEXT;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS last_status_check  TIMESTAMPTZ;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS timeline           JSONB NOT NULL DEFAULT '[]'::jsonb;
