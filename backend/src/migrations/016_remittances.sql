-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 016 — Wise remittance module (Nextgenase Inc)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS remittances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wise_transfer_id VARCHAR(255),
  wise_quote_id    VARCHAR(255),
  recipient_id     VARCHAR(255),

  source_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  target_currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  source_amount   NUMERIC(15,2),
  target_amount   NUMERIC(15,2),
  exchange_rate   NUMERIC(15,6),
  wise_fee        NUMERIC(15,2),

  recipient_name    VARCHAR(255),
  recipient_bank    VARCHAR(255),
  recipient_account VARCHAR(255),
  recipient_country VARCHAR(3),

  purpose   VARCHAR(50),                    -- salary | vendor | client_payout | other
  reference TEXT,

  payroll_item_id UUID,
  payout_id       UUID,
  expense_id      UUID,

  status      VARCHAR(30) NOT NULL DEFAULT 'draft',
  -- draft | quote_created | transfer_created | processing | sent | completed | failed | cancelled
  wise_status VARCHAR(50),
  estimated_delivery TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,

  created_by  UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,

  wise_receipt_url TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rem_status     ON remittances(status);
CREATE INDEX IF NOT EXISTS idx_rem_payroll    ON remittances(payroll_item_id);
CREATE INDEX IF NOT EXISTS idx_rem_created    ON remittances(created_at DESC);
