-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 025 — Remittance channels.
--
-- Captures non-Wise sending rails (bank wires, RIA / Western Union /
-- MoneyGram, hawala, SWIFT, …). The Settings page lets staff add/edit
-- these; the Remittance flow exposes them as "From account" options
-- alongside the live Wise integration.
--
-- channel_type is a soft enum (kept as VARCHAR so adding a new channel
-- type is a settings-time change, not a schema migration).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS remittance_channels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  channel_type      VARCHAR(50)  NOT NULL DEFAULT 'wire',
  account_reference TEXT,
  instructions      TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remittance_channels_active
  ON remittance_channels(channel_type) WHERE is_active = true;
