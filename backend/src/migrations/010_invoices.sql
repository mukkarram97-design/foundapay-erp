-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 010 — invoices module
-- Stand-alone invoices that can later be tied to a payment_link_request
-- when the customer pays. Soft-delete capable; idempotent.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number    VARCHAR(40) UNIQUE NOT NULL,

  -- Issuer
  client_id         UUID REFERENCES clients(id),
  entity_id         UUID REFERENCES entities(id),

  -- Customer (stored on the invoice — may differ from the client's contact)
  customer_name     VARCHAR(200),
  customer_email    VARCHAR(200),
  customer_phone    VARCHAR(50),
  customer_address  TEXT,

  -- Dates
  issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE,

  -- Line items as JSONB array: [{ description, quantity, unit_price, line_total }, ...]
  line_items        JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Totals (server-computed at write-time so reports never re-derive)
  subtotal          NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate          NUMERIC(6,4) NOT NULL DEFAULT 0,        -- 0.0825 = 8.25%
  tax_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency          VARCHAR(3) NOT NULL DEFAULT 'USD',

  -- Display
  notes             TEXT,
  footer_text       TEXT,

  -- Status: draft → sent → viewed → paid → overdue → cancelled
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',

  -- Pay-link bridge
  payment_link_id   UUID REFERENCES payment_link_requests(id),
  payment_link_url  TEXT,

  -- Settlement (set when marked paid / matched to a transaction)
  paid_at           TIMESTAMPTZ,
  paid_amount       NUMERIC(15,2),
  transaction_id    INTEGER REFERENCES transactions(id),

  -- Tracking
  sent_at           TIMESTAMPTZ,
  viewed_at         TIMESTAMPTZ,
  view_count        INTEGER NOT NULL DEFAULT 0,

  -- Audit
  created_by        UUID REFERENCES users(id),
  is_deleted        BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_client       ON invoices(client_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_invoices_status       ON invoices(status)    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date   ON invoices(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date     ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_no   ON invoices(invoice_number);

-- Rollback (manual): DROP TABLE invoices;
