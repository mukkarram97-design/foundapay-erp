-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 024 — Multi-brand support per client.
--
-- A "brand" is a customer-facing identity for a charge: name + logo +
-- color + statement descriptor + descriptor note. Each client can have
-- multiple brands (e.g. "Designory", "Studio Foo", "Creative Co"); when
-- a charge is generated, the operator picks which brand the customer
-- should see on the payment page and on their bank statement.
--
-- Why descriptor + descriptor_note matter:
--   - statement_descriptor: ASCII, 22-char max — the string the bank
--     prints on the cardholder's statement. Mismatched descriptors are
--     a top driver of "I don't recognize this charge" chargebacks.
--   - descriptor_note: long-form note shown ON the payment page so the
--     customer reads "your charge will appear as DESIGNORY*RNGS" before
--     they hit Pay. Reduces chargebacks via expectation-setting.
--
-- payment_link_requests + vt_transactions both gain brand_id columns so
-- the chosen brand is preserved across the funnel and visible on the
-- /pay/:token page rendered to the customer.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS client_brands (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name                  VARCHAR(120) NOT NULL,
  -- 22 chars — the max Authorize.net surfaces in some descriptor flows;
  -- some networks cap at 25, but 22 is the safe lowest-common-denominator.
  statement_descriptor  VARCHAR(22),
  -- Customer-facing note shown on the payment page, e.g.
  -- "Your charge will appear as DESIGNORY*RNGS on your statement."
  descriptor_note       TEXT,
  logo_url              TEXT,
  brand_color           VARCHAR(9),       -- '#7c3aed' or '#7c3aedff'
  support_email         VARCHAR(200),
  support_phone         VARCHAR(50),
  is_default            BOOLEAN NOT NULL DEFAULT false,
  is_archived           BOOLEAN NOT NULL DEFAULT false,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_brands_client
  ON client_brands(client_id) WHERE is_archived = false;

-- One default brand per client (when not archived).
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_brand_default
  ON client_brands(client_id) WHERE is_default = true AND is_archived = false;

-- Link the chosen brand on each generated payment request and direct charge.
ALTER TABLE payment_link_requests
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES client_brands(id);

ALTER TABLE vt_transactions
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES client_brands(id);
