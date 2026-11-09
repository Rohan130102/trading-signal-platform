-- Reverses 20261109000000_master_admin_controls. Run inside one transaction, after taking a backup, and only
-- with the application stopped and rolled back to the previous release:
--
--   psql "$DATABASE_URL" --single-transaction -f prisma/rollback/20261109000000_master_admin_controls.down.sql
--
-- What is lost: which administrator is the Master Admin, per-subscriber screenshot permissions, the platform
-- rules added here, and the list of trades removed from subscriber screens (those trades become visible to
-- subscribers again). What is kept: every trade, every event, every audit entry, including the entries that
-- record each removal. The entry window goes back to whole hours, rounded up.

BEGIN;

DROP INDEX IF EXISTS trades_closed_at_idx;
DROP TABLE IF EXISTS trade_removals;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS entry_expiry_hours_default INTEGER NOT NULL DEFAULT 0;
UPDATE app_settings SET entry_expiry_hours_default = CEIL(entry_expiry_minutes_default / 60.0)::int;
ALTER TABLE app_settings
  DROP COLUMN IF EXISTS signal_start_mode,
  DROP COLUMN IF EXISTS entry_expiry_minutes_default,
  DROP COLUMN IF EXISTS trailing_stop_wording,
  DROP COLUMN IF EXISTS screenshots_allowed_default,
  DROP COLUMN IF EXISTS history_scope,
  DROP COLUMN IF EXISTS about_body,
  DROP COLUMN IF EXISTS data_reset_at;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_screenshots_subscriber;
ALTER TABLE users DROP COLUMN IF EXISTS screenshots_allowed;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_master_admin_is_admin;
ALTER TABLE users DROP COLUMN IF EXISTS is_master_admin;
DELETE FROM _prisma_migrations WHERE migration_name = '20261109000000_master_admin_controls';

COMMIT;
