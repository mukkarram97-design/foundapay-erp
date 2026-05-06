-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 008 — payment_link_requests: viewed_at + view_count
-- Additive, idempotent.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE payment_link_requests ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
ALTER TABLE payment_link_requests ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

-- Rollback (manual):
-- ALTER TABLE payment_link_requests DROP COLUMN IF EXISTS view_count;
-- ALTER TABLE payment_link_requests DROP COLUMN IF EXISTS viewed_at;
