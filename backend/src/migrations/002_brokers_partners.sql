-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Phase 3 schema additions: brokers, partners, distributions, notifications
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS brokers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  managed_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  commission_pct DECIMAL(6,4) NOT NULL DEFAULT 0.01,
  basis VARCHAR(50) DEFAULT 'gross_received'
    CHECK (basis IN ('gross_received','revenue','net_to_client','custom')),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','inactive','paused')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brokers_client ON brokers(managed_client_id);

CREATE TABLE IF NOT EXISTS broker_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broker_id UUID REFERENCES brokers(id) ON DELETE CASCADE,
  period VARCHAR(20),
  amount DECIMAL(15,2) NOT NULL,
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  reference VARCHAR(255),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('owner','partner')),
  share_pct DECIMAL(6,4),
  email VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_distributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  period VARCHAR(20),
  entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  pct DECIMAL(6,4),
  entitled_amount DECIMAL(15,2),
  paid_amount DECIMAL(15,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending'
    CHECK (status IN ('pending','approved','paid','partially_paid')),
  paid_at TIMESTAMPTZ,
  reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed owner equity (43/33/20/2/2 from prompt)
INSERT INTO partners (name, type, share_pct, status)
VALUES
  ('Farhan Ahmed',     'owner', 0.43, 'active'),
  ('Mukkarram',        'owner', 0.33, 'active'),
  ('Other Owner A',    'owner', 0.20, 'active'),
  ('Other Owner B',    'owner', 0.02, 'active'),
  ('Other Owner C',    'owner', 0.02, 'active')
ON CONFLICT (name) DO NOTHING;

-- Seed partners (10% per company partners)
INSERT INTO partners (name, type, share_pct, status)
VALUES
  ('Moustafa Abdalla',          'partner', 0.10, 'active'),
  ('Sankalp Prakash Saste',     'partner', 0.10, 'active'),
  ('Saqib Nawaz',               'partner', 0.10, 'active'),
  ('Serigne Mbacke Ngom',       'partner', 0.10, 'active'),
  ('Veeraraghavan Narasimhan',  'partner', 0.10, 'active'),
  ('Sobia Riaz',                'partner', 0.10, 'active'),
  ('Sassouna Cisse',            'partner', 0.10, 'active'),
  ('Mohammad Asfandyar Malik',  'partner', 0.10, 'active')
ON CONFLICT (name) DO NOTHING;

-- Seed initial brokers from prompt
INSERT INTO brokers (name, commission_pct, status, notes)
SELECT 'Faraz Alvi', 0.01, 'active', 'Manages Irtiza Khokar — 1%'
WHERE NOT EXISTS (SELECT 1 FROM brokers WHERE name = 'Faraz Alvi');
INSERT INTO brokers (name, commission_pct, status, notes)
SELECT 'Nisaar Ahmed', 0.01, 'active', 'Manages Adil — 1%'
WHERE NOT EXISTS (SELECT 1 FROM brokers WHERE name = 'Nisaar Ahmed');
INSERT INTO brokers (name, commission_pct, status, notes)
SELECT 'Mehdi', 0.02, 'active', 'Manages Azeem — 2%'
WHERE NOT EXISTS (SELECT 1 FROM brokers WHERE name = 'Mehdi');

-- Link brokers to their clients (best-effort by name)
UPDATE brokers SET managed_client_id = c.id
  FROM clients c WHERE c.name = 'Irtiza Khokar' AND brokers.name = 'Faraz Alvi';
UPDATE brokers SET managed_client_id = c.id
  FROM clients c WHERE c.name = 'Adil' AND brokers.name = 'Nisaar Ahmed';
UPDATE brokers SET managed_client_id = c.id
  FROM clients c WHERE c.name = 'Azeem' AND brokers.name = 'Mehdi';

-- Notifications: add proof_url column to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS proof_url TEXT;
