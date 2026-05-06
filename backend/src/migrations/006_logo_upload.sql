-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 006 — Logo upload: clients.logo_url + entities.logo_url
-- Additive only. Idempotent.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_uploaded_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_uploaded_by UUID REFERENCES users(id);

ALTER TABLE entities ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS logo_uploaded_at TIMESTAMPTZ;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS logo_uploaded_by UUID REFERENCES users(id);

-- Rollback (manual):
-- ALTER TABLE clients  DROP COLUMN IF EXISTS logo_uploaded_by;
-- ALTER TABLE clients  DROP COLUMN IF EXISTS logo_uploaded_at;
-- ALTER TABLE clients  DROP COLUMN IF EXISTS logo_url;
-- ALTER TABLE entities DROP COLUMN IF EXISTS logo_uploaded_by;
-- ALTER TABLE entities DROP COLUMN IF EXISTS logo_uploaded_at;
-- ALTER TABLE entities DROP COLUMN IF EXISTS logo_url;
