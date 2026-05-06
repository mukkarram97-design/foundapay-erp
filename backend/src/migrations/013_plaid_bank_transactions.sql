-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 013 — Plaid + bank_transactions ledger
-- Stores Plaid item access tokens (encrypted via env-based key, see services/plaid.js)
-- and a bank_transactions ledger for both Plaid-synced and CSV-imported rows.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS plaid_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID UNIQUE REFERENCES bank_accounts(id) ON DELETE CASCADE,
  item_id         VARCHAR(100) NOT NULL,
  access_token    TEXT NOT NULL, -- Plaid sandbox/dev/prod access token (treat as secret)
  institution_id  VARCHAR(100),
  institution_name VARCHAR(200),
  plaid_account_id VARCHAR(100),       -- the specific account_id we linked
  cursor          TEXT,                 -- transactions/sync cursor
  last_synced_at  TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id              BIGSERIAL PRIMARY KEY,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  source          VARCHAR(20) NOT NULL DEFAULT 'plaid', -- 'plaid' | 'csv' | 'manual'
  external_id     VARCHAR(200),                          -- Plaid transaction_id; null for csv/manual
  posted_date     DATE NOT NULL,
  description     TEXT,
  merchant_name   VARCHAR(200),
  category        VARCHAR(100),
  amount          NUMERIC(15,2) NOT NULL,                -- positive = inflow; negative = outflow
  currency        VARCHAR(3) DEFAULT 'USD',
  pending         BOOLEAN NOT NULL DEFAULT false,
  raw             JSONB,                                  -- Plaid raw payload or CSV row
  matched_transaction_id INTEGER REFERENCES transactions(id),
  is_deleted      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_tx_external
  ON bank_transactions(bank_account_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_tx_bank_date
  ON bank_transactions(bank_account_id, posted_date DESC) WHERE is_deleted = false;

-- bank_accounts already exists (schema.sql). Add Plaid-relevant columns idempotently.
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS plaid_linked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS plaid_synced_at TIMESTAMPTZ;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
