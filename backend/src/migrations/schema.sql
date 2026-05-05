-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FoundaPay ERP — Master Schema
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USERS / AUTH ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) NOT NULL CHECK (role IN (
    'super_admin','owner','admin','finance_manager','operations_manager',
    'accountant','remote_operator','client_user','entity_owner','auditor'
  )),
  phone VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  login_count INTEGER DEFAULT 0,
  reset_token VARCHAR(255),
  reset_token_expires TIMESTAMPTZ,
  two_fa_enabled BOOLEAN DEFAULT false,
  client_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id);

CREATE TABLE IF NOT EXISTS login_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  status VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100),
  resource VARCHAR(100),
  resource_id VARCHAR(100),
  old_value JSONB,
  new_value JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource, resource_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reset_token ON password_reset_tokens(token);

-- ── CLIENTS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) UNIQUE NOT NULL,
  company_name VARCHAR(255),
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  whatsapp VARCHAR(50),
  country VARCHAR(100) DEFAULT 'Pakistan',
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','inactive','on_hold','risk')),
  card_pct DECIMAL(6,4) DEFAULT 0,
  wire_pct DECIMAL(6,4) DEFAULT 0,
  cheque_pct DECIMAL(6,4) DEFAULT 0,
  ach_pct DECIMAL(6,4) DEFAULT 0,
  zelle_pct DECIMAL(6,4) DEFAULT 0,
  other_terms TEXT,
  opening_balance DECIMAL(15,2) DEFAULT 0,
  total_received DECIMAL(15,2) DEFAULT 0,
  balance_owed DECIMAL(15,2) DEFAULT 0,
  our_revenue DECIMAL(15,2) DEFAULT 0,
  settlement_cycle VARCHAR(50) DEFAULT 'weekly',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

CREATE TABLE IF NOT EXISTS client_visibility_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  show_gross_amount BOOLEAN DEFAULT true,
  show_customer_name BOOLEAN DEFAULT true,
  show_customer_email BOOLEAN DEFAULT false,
  show_merchant_fee BOOLEAN DEFAULT false,
  show_commission BOOLEAN DEFAULT false,
  show_reserve_amount BOOLEAN DEFAULT true,
  show_chargeback BOOLEAN DEFAULT true,
  show_settlement_date BOOLEAN DEFAULT true,
  show_processor_name BOOLEAN DEFAULT false,
  show_entity_name BOOLEAN DEFAULT false,
  show_bank_account BOOLEAN DEFAULT false,
  show_payout_status BOOLEAN DEFAULT true,
  show_balance BOOLEAN DEFAULT true,
  show_statement_download BOOLEAN DEFAULT true,
  show_proof_files BOOLEAN DEFAULT false,
  show_card_assigned BOOLEAN DEFAULT true
);

-- ── ENTITIES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  legal_name VARCHAR(255) UNIQUE NOT NULL,
  dba_name VARCHAR(255),
  entity_type VARCHAR(50) DEFAULT 'LLC',
  owner_name VARCHAR(255),
  owner_email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  company_address TEXT,
  ein_reference VARCHAR(255),
  website VARCHAR(255),
  partner_name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  risk_status VARCHAR(50) DEFAULT 'normal',
  monthly_processing_limit DECIMAL(15,2),
  current_month_volume DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entities_legal_name ON entities(legal_name);

-- ── BANK ACCOUNTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  bank_name VARCHAR(255),
  account_nickname VARCHAR(255),
  account_last4 VARCHAR(4),
  routing_reference VARCHAR(255),
  zelle_id VARCHAR(255),
  opening_balance DECIMAL(15,2) DEFAULT 0,
  current_balance DECIMAL(15,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── MERCHANTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processor_name VARCHAR(255),
  account_name VARCHAR(255),
  entity_id UUID REFERENCES entities(id),
  bank_account_id UUID REFERENCES bank_accounts(id),
  mid VARCHAR(255),
  processing_fee_pct DECIMAL(6,4) DEFAULT 0,
  fixed_fee DECIMAL(10,2) DEFAULT 0,
  reserve_pct DECIMAL(6,4) DEFAULT 0,
  chargeback_fee DECIMAL(10,2) DEFAULT 0,
  settlement_delay_days INTEGER DEFAULT 2,
  daily_limit DECIMAL(15,2),
  monthly_limit DECIMAL(15,2),
  current_month_volume DECIMAL(15,2) DEFAULT 0,
  availability VARCHAR(50) DEFAULT 'available' CHECK (availability IN (
    'available','paused','blocked','on_hold','restricted','closed'
  )),
  risk_status VARCHAR(50) DEFAULT 'normal',
  chargeback_rate DECIMAL(6,4) DEFAULT 0,
  supported_methods TEXT[],
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CARDS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nickname VARCHAR(255),
  last4 VARCHAR(4),
  card_type VARCHAR(20) CHECK (card_type IN ('physical','virtual')),
  bank_name VARCHAR(255),
  network VARCHAR(50),
  entity_id UUID REFERENCES entities(id),
  cardholder_name VARCHAR(255),
  cardholder_user_id UUID REFERENCES users(id),
  monthly_limit DECIMAL(15,2),
  alert_threshold_pct INTEGER DEFAULT 80,
  expiry VARCHAR(50),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN (
    'active','inactive','blocked','expired','cancelled'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CLIENT-CARD ASSIGNMENTS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS client_card_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- ── TRANSACTIONS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) CHECK (type IN (
    'Received','Paid','Settlement','Payout','Expense',
    'Reserve Hold','Reserve Release','Chargeback','Refund','Adjustment','Advance Paid'
  )),
  date_received DATE,
  client_id UUID REFERENCES clients(id),
  counterparty_type VARCHAR(50),
  counterparty_name VARCHAR(255),
  entity_id UUID REFERENCES entities(id),
  merchant_id UUID REFERENCES merchants(id),
  payment_method VARCHAR(50),
  sending_method VARCHAR(50),
  company_name VARCHAR(255),
  merchant_account VARCHAR(255),
  gross_amount DECIMAL(15,4) DEFAULT 0,
  foundapay_fee_pct DECIMAL(6,4) DEFAULT 0,
  fee_amount DECIMAL(15,4) DEFAULT 0,
  merchant_charges DECIMAL(15,4) DEFAULT 0,
  bearing_merchant_charges VARCHAR(50),
  net_amount DECIMAL(15,4),
  funds_available_date DATE,
  processor_fee_pct DECIMAL(6,4) DEFAULT 0,
  processor_fee_amount DECIMAL(15,4) DEFAULT 0,
  processor_fee_bearer VARCHAR(50) DEFAULT 'Client',
  reserve_pct DECIMAL(6,4) DEFAULT 0,
  reserve_amount DECIMAL(15,4) DEFAULT 0,
  reserve_bearer VARCHAR(50) DEFAULT 'Client',
  status VARCHAR(50) DEFAULT 'Completed',
  external_txn_id VARCHAR(255),
  processor_reference VARCHAR(255),
  payment_link_id UUID,
  approved_by UUID REFERENCES users(id),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date_received);
CREATE INDEX IF NOT EXISTS idx_tx_client ON transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_tx_entity ON transactions(entity_id);
CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

-- ── EXPENSES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE,
  card_id UUID REFERENCES cards(id),
  entity_id UUID REFERENCES entities(id),
  category VARCHAR(100),
  subcategory VARCHAR(100),
  vendor VARCHAR(255),
  description TEXT,
  amount DECIMAL(15,2),
  currency VARCHAR(10) DEFAULT 'USD',
  payment_type VARCHAR(50) DEFAULT 'card',
  is_client_billable BOOLEAN DEFAULT false,
  client_id UUID REFERENCES clients(id),
  is_recurring BOOLEAN DEFAULT false,
  recurrence_interval VARCHAR(50),
  next_renewal_date DATE,
  receipt_url TEXT,
  status VARCHAR(50) DEFAULT 'approved',
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── ASSETS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255),
  asset_type VARCHAR(50) CHECK (asset_type IN (
    'domain','vps','hosting','software_license','hardware','tool','subscription_seat','other'
  )),
  vendor VARCHAR(255),
  purchase_date DATE,
  purchase_amount DECIMAL(15,2),
  card_id UUID REFERENCES cards(id),
  entity_id UUID REFERENCES entities(id),
  ownership_type VARCHAR(50) DEFAULT 'internal' CHECK (ownership_type IN ('internal','client','shared')),
  client_id UUID REFERENCES clients(id),
  is_recurring BOOLEAN DEFAULT false,
  renewal_date DATE,
  annual_cost DECIMAL(15,2),
  renewal_alert_days INTEGER DEFAULT 30,
  status VARCHAR(50) DEFAULT 'active',
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RESERVES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reserves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id INTEGER REFERENCES transactions(id),
  client_id UUID REFERENCES clients(id),
  merchant_id UUID REFERENCES merchants(id),
  amount DECIMAL(15,4),
  bearer VARCHAR(50) DEFAULT 'Client',
  reserve_type VARCHAR(50),
  hold_date DATE,
  release_date DATE,
  released_amount DECIMAL(15,4) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'held' CHECK (status IN (
    'held','released','partially_released','forfeited'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CHARGEBACKS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chargebacks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id INTEGER REFERENCES transactions(id),
  client_id UUID REFERENCES clients(id),
  merchant_id UUID REFERENCES merchants(id),
  customer_name VARCHAR(255),
  amount DECIMAL(15,4),
  cb_fee DECIMAL(10,2) DEFAULT 0,
  reason TEXT,
  evidence_deadline DATE,
  evidence_uploaded BOOLEAN DEFAULT false,
  result VARCHAR(50),
  status VARCHAR(50) DEFAULT 'open' CHECK (status IN (
    'open','evidence_submitted','won','lost','escalated','closed'
  )),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PAYOUTS (7-stage workflow) ────────────────────────────────
CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id),
  amount DECIMAL(15,4),
  currency VARCHAR(10) DEFAULT 'USD',
  country VARCHAR(100),
  recipient_name VARCHAR(255),
  payout_method VARCHAR(50),
  exchange_rate DECIMAL(10,4),
  transfer_fee DECIMAL(10,2),
  reference_number VARCHAR(255),
  proof_url TEXT,
  status VARCHAR(50) DEFAULT 'prepared' CHECK (status IN (
    'prepared','finance_review','admin_approval','approved','sent','proof_uploaded','closed','rejected'
  )),
  prepared_by UUID REFERENCES users(id),
  finance_reviewed_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  sent_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PAYMENT LINKS / VIRTUAL TERMINAL ──────────────────────────
CREATE TABLE IF NOT EXISTS payment_link_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_number SERIAL,
  client_id UUID REFERENCES clients(id),
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(50),
  amount DECIMAL(15,2),
  currency VARCHAR(10) DEFAULT 'USD',
  description TEXT,
  invoice_number VARCHAR(100),
  payment_method VARCHAR(50),
  entity_id UUID REFERENCES entities(id),
  merchant_id UUID REFERENCES merchants(id),
  processor_link TEXT,
  link_generated_at TIMESTAMPTZ,
  link_sent_at TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'requested' CHECK (status IN (
    'requested','assigned','merchant_selected','link_generated',
    'sent_to_client','sent_to_customer','waiting_payment',
    'paid','failed','cancelled','refunded'
  )),
  screenshot_url TEXT,
  transaction_id INTEGER REFERENCES transactions(id),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── SALARY ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_disbursements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period VARCHAR(20),
  pay_date DATE,
  currency VARCHAR(10) DEFAULT 'USD',
  exchange_rate DECIMAL(8,2) DEFAULT 280,
  total_usd DECIMAL(10,2),
  total_pkr DECIMAL(15,2),
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','approved','disbursed')),
  approved_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salary_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  disbursement_id UUID REFERENCES salary_disbursements(id) ON DELETE CASCADE,
  employee_name VARCHAR(255),
  full_name VARCHAR(255),
  bank_name VARCHAR(255),
  account_number VARCHAR(100),
  amount_usd DECIMAL(10,2),
  amount_pkr DECIMAL(15,2),
  status VARCHAR(50) DEFAULT 'pending',
  paid_at TIMESTAMPTZ
);

-- ── ACCOUNTING ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(10) UNIQUE,
  name VARCHAR(255),
  type VARCHAR(20) CHECK (type IN ('asset','liability','income','expense','equity')),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_id VARCHAR(100),
  reference_type VARCHAR(50),
  description TEXT,
  entries JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RECONCILIATION ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconciliation_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255),
  period_from DATE,
  period_to DATE,
  entity_id UUID REFERENCES entities(id),
  merchant_id UUID REFERENCES merchants(id),
  status VARCHAR(50) DEFAULT 'open',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES reconciliation_batches(id) ON DELETE CASCADE,
  transaction_id INTEGER REFERENCES transactions(id),
  date DATE,
  amount DECIMAL(15,2),
  reference VARCHAR(255),
  counterparty VARCHAR(255),
  source VARCHAR(20) CHECK (source IN ('bank','processor','ledger')),
  status VARCHAR(50) CHECK (status IN ('matched','partial','difference','missing','needs_review')),
  difference DECIMAL(15,2),
  notes TEXT
);

-- ── CMS / NOTIFICATIONS / EMAIL LOGS ──────────────────────────
CREATE TABLE IF NOT EXISTS cms_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) UNIQUE,
  value JSONB,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50),
  title VARCHAR(255),
  message TEXT,
  resource_type VARCHAR(50),
  resource_id VARCHAR(100),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_email VARCHAR(255),
  recipient_name VARCHAR(255),
  subject VARCHAR(500),
  template VARCHAR(50),
  status VARCHAR(20) CHECK (status IN ('sent','failed','bounced','console')),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  error_message TEXT
);

-- FK from users.client_id → clients.id (added after clients table exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_users_client'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_client
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
  END IF;
END $$;
