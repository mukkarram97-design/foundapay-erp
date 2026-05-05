-- Phase 4: Virtual Terminal — Authorize.net live integration
-- Tables: vt_transactions, client_terminal_access

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS vt_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  processor VARCHAR(50) DEFAULT 'authorize_net',
  processor_transaction_id VARCHAR(255),
  processor_auth_code VARCHAR(100),
  processor_response_code VARCHAR(20),
  processor_response_text TEXT,
  card_last4 VARCHAR(4),
  card_type VARCHAR(20),
  card_holder_name VARCHAR(255),
  amount DECIMAL(15,2),
  currency VARCHAR(3) DEFAULT 'USD',
  charge_type VARCHAR(20) DEFAULT 'direct_charge'
    CHECK (charge_type IN ('direct_charge','hosted_link','refund','void')),
  hosted_link_url TEXT,
  hosted_link_token TEXT,
  hosted_link_expires_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','success','declined','voided','refunded','expired','error','held','unknown')),
  charged_by UUID REFERENCES users(id),
  client_id UUID REFERENCES clients(id),
  entity_id UUID REFERENCES entities(id),
  invoice_number VARCHAR(100),
  description TEXT,
  customer_email VARCHAR(255),
  logo_type VARCHAR(20) DEFAULT 'entity'
    CHECK (logo_type IN ('entity','custom','none')),
  custom_logo_url TEXT,
  brand_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vt_charged_by   ON vt_transactions(charged_by);
CREATE INDEX IF NOT EXISTS idx_vt_client       ON vt_transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_vt_status       ON vt_transactions(status);
CREATE INDEX IF NOT EXISTS idx_vt_created_at   ON vt_transactions(created_at);

CREATE TABLE IF NOT EXISTS client_terminal_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id),
  entity_id UUID REFERENCES entities(id),
  can_direct_charge BOOLEAN DEFAULT false,
  can_generate_links BOOLEAN DEFAULT true,
  daily_limit DECIMAL(15,2),
  per_transaction_limit DECIMAL(15,2),
  assigned_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cta_client ON client_terminal_access(client_id);
