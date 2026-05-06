-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 018 — Remittance provider abstraction
-- Lets remittances support more than Wise (manual wires, SWIFT, ACH, …).
-- All additive + idempotent.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE remittances ADD COLUMN IF NOT EXISTS provider               VARCHAR(30)  NOT NULL DEFAULT 'wise';
-- wise | manual | swift | ach | paypal | other
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS provider_reference     VARCHAR(255);
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS provider_fee           NUMERIC(15,2);
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS provider_exchange_rate NUMERIC(15,6);

CREATE INDEX IF NOT EXISTS idx_rem_provider ON remittances(provider);
