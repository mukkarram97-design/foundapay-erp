-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 011 — payment_link_requests: device tracking
-- Capture IP, user-agent and device class on link open and payment.
-- Additive, idempotent.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE payment_link_requests ADD COLUMN IF NOT EXISTS payer_ip               INET;
ALTER TABLE payment_link_requests ADD COLUMN IF NOT EXISTS payer_user_agent       TEXT;
ALTER TABLE payment_link_requests ADD COLUMN IF NOT EXISTS payer_device_type      VARCHAR(20);
ALTER TABLE payment_link_requests ADD COLUMN IF NOT EXISTS first_opened_ip        INET;
ALTER TABLE payment_link_requests ADD COLUMN IF NOT EXISTS first_opened_user_agent TEXT;
ALTER TABLE payment_link_requests ADD COLUMN IF NOT EXISTS first_opened_device    VARCHAR(20);
ALTER TABLE payment_link_requests ADD COLUMN IF NOT EXISTS first_opened_at        TIMESTAMPTZ;

-- Rollback (manual):
-- ALTER TABLE payment_link_requests DROP COLUMN IF EXISTS payer_ip,
--   DROP COLUMN IF EXISTS payer_user_agent, DROP COLUMN IF EXISTS payer_device_type,
--   DROP COLUMN IF EXISTS first_opened_ip, DROP COLUMN IF EXISTS first_opened_user_agent,
--   DROP COLUMN IF EXISTS first_opened_device, DROP COLUMN IF EXISTS first_opened_at;
