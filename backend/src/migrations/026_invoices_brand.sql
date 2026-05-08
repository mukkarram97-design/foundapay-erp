-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 026 — Invoices carry their brand_id directly.
--
-- Mig 024 added brand_id to payment_link_requests and vt_transactions
-- but not invoices. The invoice PDF wants the brand identity (logo,
-- statement descriptor, descriptor note, support contact) in the
-- header + footer. Storing brand_id on the invoice avoids re-deriving
-- via the linked PLR and keeps the PDF stable if the PLR is later
-- archived.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES client_brands(id);
