-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 020 — Manual-wire proof support + ERP-side saved recipients address book.
-- All additive + idempotent.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE remittances ADD COLUMN IF NOT EXISTS channel             VARCHAR(30);
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS proof_url           TEXT;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS proof_uploaded_at   TIMESTAMPTZ;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS proof_uploaded_by   UUID REFERENCES users(id);
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS manual_rate         NUMERIC(15,6);
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS manual_notes        TEXT;
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS transaction_id      INTEGER REFERENCES transactions(id);

-- Backfill channel from existing provider column for any rows missing it
UPDATE remittances SET channel = provider WHERE channel IS NULL AND provider IS NOT NULL;

-- ERP-side saved recipients (separate from Wise's own list).
-- Lets operators save recipients that aren't in Wise (manual wires) AND
-- alias Wise recipients with a friendly name + tags for repeat use.
CREATE TABLE IF NOT EXISTS remittance_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  country           VARCHAR(3),
  bank_name         VARCHAR(255),
  account_type      VARCHAR(50),
  iban              VARCHAR(50),
  account_number    VARCHAR(50),
  routing_number    VARCHAR(20),
  sort_code         VARCHAR(20),
  swift_bic         VARCHAR(20),
  branch_code       VARCHAR(20),
  city              VARCHAR(100),
  address_line      VARCHAR(255),
  post_code         VARCHAR(20),
  email             VARCHAR(255),
  legal_type        VARCHAR(20) DEFAULT 'PRIVATE',
  wise_recipient_id VARCHAR(100), -- mirror of the Wise account id when one was created
  notes             TEXT,
  payroll_item_link UUID,         -- optional: link to a salary_items row for repeat salary remittances
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rem_recipients_name    ON remittance_recipients(name) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_rem_recipients_country ON remittance_recipients(country) WHERE is_deleted = false;
