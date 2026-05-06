-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 017 — User permission matrix + usage tracking
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Module access
  can_virtual_terminal  BOOLEAN NOT NULL DEFAULT false,
  can_payment_links     BOOLEAN NOT NULL DEFAULT false,
  can_invoices          BOOLEAN NOT NULL DEFAULT false,
  can_master_ledger     BOOLEAN NOT NULL DEFAULT false,
  can_reports           BOOLEAN NOT NULL DEFAULT false,
  can_payouts           BOOLEAN NOT NULL DEFAULT false,
  can_reconciliation    BOOLEAN NOT NULL DEFAULT false,
  can_bank_accounts     BOOLEAN NOT NULL DEFAULT false,
  can_remittance        BOOLEAN NOT NULL DEFAULT false,
  can_clients           BOOLEAN NOT NULL DEFAULT false,
  can_chargebacks       BOOLEAN NOT NULL DEFAULT false,
  can_reserves          BOOLEAN NOT NULL DEFAULT false,
  can_expenses          BOOLEAN NOT NULL DEFAULT false,
  can_approvals         BOOLEAN NOT NULL DEFAULT false,

  -- VT charge-type sub-permissions
  vt_direct_charge      BOOLEAN NOT NULL DEFAULT false,
  vt_payment_links      BOOLEAN NOT NULL DEFAULT false,
  vt_invoices           BOOLEAN NOT NULL DEFAULT false,
  vt_merchants          JSONB   NOT NULL DEFAULT '[]'::jsonb, -- merchant IDs allowed

  -- VT limits (0 = unlimited)
  vt_limit_per_transaction NUMERIC(15,2) NOT NULL DEFAULT 0,
  vt_limit_daily            NUMERIC(15,2) NOT NULL DEFAULT 0,
  vt_limit_monthly          NUMERIC(15,2) NOT NULL DEFAULT 0,
  vt_max_links_per_day      INTEGER       NOT NULL DEFAULT 0,
  vt_max_links_per_month    INTEGER       NOT NULL DEFAULT 0,
  vt_link_max_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  vt_link_auto_expire_hours INTEGER       NOT NULL DEFAULT 24,

  -- Limit behaviour
  limit_action     VARCHAR(20) NOT NULL DEFAULT 'block',         -- block | warn | require_approval
  limit_reset_type VARCHAR(20) NOT NULL DEFAULT 'monthly_first', -- monthly_first | rolling_30

  -- Data visibility
  see_own_data_only  BOOLEAN NOT NULL DEFAULT true,
  client_id          UUID REFERENCES clients(id),
  show_usage_to_user BOOLEAN NOT NULL DEFAULT true,

  configured_by UUID REFERENCES users(id),
  configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS user_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,

  total_charged          NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_links_created    INTEGER       NOT NULL DEFAULT 0,
  total_invoices_created INTEGER       NOT NULL DEFAULT 0,
  largest_transaction    NUMERIC(15,2) NOT NULL DEFAULT 0,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_up_user            ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_uu_user_period     ON user_usage(user_id, period_start);
