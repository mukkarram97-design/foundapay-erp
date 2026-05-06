-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 009 — Soft delete: is_deleted column on 7 tables
-- Additive, idempotent. Existing rows get is_deleted=false automatically
-- (PG fills the default for existing rows on ADD COLUMN with DEFAULT).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE transactions     ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clients          ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE entities         ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payouts          ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE chargebacks      ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE expenses         ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vt_transactions  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- Optional: deletion-metadata columns (who/when/why) for audit transparency.
-- Add only on transactions for now since it's the most-used; others can wait.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

-- Partial indexes — speed up the common WHERE is_deleted = false filter.
CREATE INDEX IF NOT EXISTS idx_tx_active           ON transactions(id)     WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_clients_active      ON clients(id)          WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_entities_active     ON entities(id)         WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_vt_active           ON vt_transactions(id)  WHERE is_deleted = false;

-- Rollback (manual):
-- DROP INDEX IF EXISTS idx_vt_active, idx_entities_active, idx_clients_active, idx_tx_active;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS deleted_by;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE vt_transactions  DROP COLUMN IF EXISTS is_deleted;
-- ALTER TABLE expenses         DROP COLUMN IF EXISTS is_deleted;
-- ALTER TABLE chargebacks      DROP COLUMN IF EXISTS is_deleted;
-- ALTER TABLE payouts          DROP COLUMN IF EXISTS is_deleted;
-- ALTER TABLE entities         DROP COLUMN IF EXISTS is_deleted;
-- ALTER TABLE clients          DROP COLUMN IF EXISTS is_deleted;
-- ALTER TABLE transactions     DROP COLUMN IF EXISTS is_deleted;
