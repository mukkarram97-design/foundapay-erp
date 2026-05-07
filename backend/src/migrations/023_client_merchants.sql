-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 023 — Client ↔ Merchant junction table.
--
-- Lets each client be assigned a subset of merchants with per-pair
-- settings (default, charge-type permissions, dollar limits). VT uses
-- this to filter the merchant dropdown by selected client.
-- Backfill: link every existing client to every is_live merchant so the
-- current flow keeps working — earliest-created merchant becomes default.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS client_merchants (
  client_id              UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id            UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  is_default             BOOLEAN NOT NULL DEFAULT false,
  can_direct_charge      BOOLEAN NOT NULL DEFAULT true,
  can_generate_links     BOOLEAN NOT NULL DEFAULT true,
  can_generate_invoices  BOOLEAN NOT NULL DEFAULT true,
  per_transaction_limit  NUMERIC(15,2) NOT NULL DEFAULT 0, -- 0 = unlimited
  daily_limit            NUMERIC(15,2) NOT NULL DEFAULT 0,
  monthly_limit          NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes                  TEXT,
  created_by             UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_cm_client   ON client_merchants(client_id);
CREATE INDEX IF NOT EXISTS idx_cm_merchant ON client_merchants(merchant_id);

-- Only one default per client.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cm_default_per_client
  ON client_merchants(client_id) WHERE is_default = true;

-- Backfill: every (active client × is_live merchant) pair. Default = the
-- earliest-created live merchant for that client.
INSERT INTO client_merchants (client_id, merchant_id, is_default)
SELECT c.id, m.id,
       (m.id = (
          SELECT m2.id FROM merchants m2
           WHERE m2.is_live = true AND m2.is_deleted = false
           ORDER BY m2.created_at ASC LIMIT 1
       ))
  FROM clients c
  CROSS JOIN merchants m
 WHERE c.is_deleted = false
   AND m.is_live = true
   AND m.is_deleted = false
ON CONFLICT (client_id, merchant_id) DO NOTHING;
