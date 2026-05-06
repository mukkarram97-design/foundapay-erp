-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 014 — Merchants overhaul
-- Adds processor_type, logo, api_credentials (JSONB), live/sandbox flags,
-- health-check fields, contact info, soft-delete. All additive + idempotent.
-- The existing supported_methods column is TEXT[]; we keep it (legacy
-- routing engine reads from it). The spec's `supported_methods JSONB` is
-- a parallel column added under a different name to avoid breaking it.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS processor_type     VARCHAR(50)   DEFAULT 'authnet';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS logo_url           TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS logo_uploaded_at   TIMESTAMPTZ;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS api_credentials    JSONB         NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_live            BOOLEAN       NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_sandbox         BOOLEAN       NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS health_status      VARCHAR(20)   NOT NULL DEFAULT 'unknown';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS health_checked_at  TIMESTAMPTZ;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS health_message     TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS monthly_volume_cap DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS supported_methods_json JSONB     NOT NULL DEFAULT '["cards"]'::jsonb;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS contact_name       VARCHAR(255);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS contact_email      VARCHAR(255);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS contact_phone      VARCHAR(50);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_deleted         BOOLEAN       NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW();

-- Bootstrap Designory Inc as the default authnet merchant if it exists.
-- Marks it live by default; the first ad-hoc health check populates real status.
-- Sandbox flag stays whatever the team sets via the UI (defaults to false).
UPDATE merchants
   SET processor_type = 'authnet',
       is_live        = true,
       updated_at     = NOW()
 WHERE processor_name ILIKE '%designory%';
