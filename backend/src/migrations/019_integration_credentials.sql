-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 019 — Encrypted integration credentials vault.
-- Lets super_admins enter API tokens via the UI and stores them
-- AES-256-GCM-encrypted (key derived from APP_ENCRYPTION_KEY env).
-- The encrypted_payload column holds { iv, ciphertext, tag } as hex strings.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS integration_credentials (
  provider          VARCHAR(50) PRIMARY KEY,     -- e.g. 'wise', 'stripe'
  encrypted_payload JSONB,                        -- { iv, ciphertext, tag } | null
  metadata          JSONB NOT NULL DEFAULT '{}', -- profile_id, environment, etc — non-secret
  configured_at     TIMESTAMPTZ,
  configured_by     UUID REFERENCES users(id),
  last_tested_at    TIMESTAMPTZ,
  last_test_status  VARCHAR(20),                  -- ok | error | unknown
  last_test_message TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
