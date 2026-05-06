-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 012 — salary_items: is_active + notes
-- Adds Active/Inactive flag (separate from pay-cycle status) and a free-form
-- notes column. Additive, idempotent.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE salary_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE salary_items ADD COLUMN IF NOT EXISTS notes     TEXT;
