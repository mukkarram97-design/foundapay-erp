-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 015 — Approval requests (two-step approval workflow)
-- Covers: payout_request | refund_request | void_request | expense_approval
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,                            -- payout_request | refund_request | void_request | expense_approval
  status VARCHAR(20) NOT NULL DEFAULT 'pending',        -- pending | admin_approved | super_approved | proof_uploaded | rejected | completed
  reference_type VARCHAR(50),                           -- transaction | payout | expense | payment_link
  reference_id   VARCHAR(255),
  amount         DECIMAL(15,2),
  currency       VARCHAR(3) DEFAULT 'USD',

  requested_by   UUID REFERENCES users(id),
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_reason TEXT,

  admin_reviewed_by UUID REFERENCES users(id),
  admin_reviewed_at TIMESTAMPTZ,
  admin_decision VARCHAR(20),                           -- approved | rejected
  admin_notes    TEXT,

  super_reviewed_by UUID REFERENCES users(id),
  super_reviewed_at TIMESTAMPTZ,
  super_decision VARCHAR(20),                           -- approved | rejected
  super_notes    TEXT,

  proof_url        TEXT,
  proof_uploaded_at TIMESTAMPTZ,
  proof_uploaded_by UUID REFERENCES users(id),

  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_apr_status       ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_apr_type         ON approval_requests(type);
CREATE INDEX IF NOT EXISTS idx_apr_requested_by ON approval_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_apr_created      ON approval_requests(created_at DESC);
