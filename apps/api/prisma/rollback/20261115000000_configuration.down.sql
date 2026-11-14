-- Reverses 20261115000000_configuration. Run inside one transaction, after taking a backup, with the
-- application stopped and rolled back to the previous release:
--
--   psql "$DATABASE_URL" --single-transaction -f prisma/rollback/20261115000000_configuration.down.sql
--
-- What is lost: the sign-up switch, the usual trial length, and the email account entered on the configuration
-- screen. Email then comes only from the server's environment again, as before. Nothing else changes.

BEGIN;

ALTER TABLE app_settings
  DROP CONSTRAINT IF EXISTS app_settings_email_complete,
  DROP COLUMN IF EXISTS signup_open,
  DROP COLUMN IF EXISTS default_trial_days,
  DROP COLUMN IF EXISTS email_enabled,
  DROP COLUMN IF EXISTS smtp_host,
  DROP COLUMN IF EXISTS smtp_port,
  DROP COLUMN IF EXISTS smtp_security,
  DROP COLUMN IF EXISTS smtp_username,
  DROP COLUMN IF EXISTS smtp_password_enc,
  DROP COLUMN IF EXISTS email_from_name,
  DROP COLUMN IF EXISTS email_from_address,
  DROP COLUMN IF EXISTS email_tested_at;

DELETE FROM _prisma_migrations WHERE migration_name = '20261115000000_configuration';

COMMIT;
