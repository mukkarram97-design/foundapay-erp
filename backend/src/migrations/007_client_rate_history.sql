-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 007 — client_rate_history: track commission-rate changes over time
-- Additive only. Idempotent.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS client_rate_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  effective_from  DATE NOT NULL,
  effective_to    DATE,           -- NULL = current rate
  card_pct        DECIMAL(8,4),
  wire_pct        DECIMAL(8,4),
  ach_pct         DECIMAL(8,4),
  zelle_pct       DECIMAL(8,4),
  cheque_pct      DECIMAL(8,4),
  changed_by      UUID REFERENCES users(id),
  change_reason   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crh_client_date
  ON client_rate_history(client_id, effective_from DESC);

-- Rollback (manual):
-- DROP INDEX IF EXISTS idx_crh_client_date;
-- DROP TABLE IF EXISTS client_rate_history;
