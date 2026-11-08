-- Reverses 20261108000000_mobile_experience. Run inside one transaction, after taking a backup, and only
-- with the application stopped and rolled back to the previous release:
--
--   psql "$DATABASE_URL" --single-transaction -f prisma/rollback/20261108000000_mobile_experience.down.sql
--
-- What is lost: announcement drafts, schedules, pins, edits and templates; who hid what; single-notification
-- read marks; device bindings; notification open times; tour completion. What is kept: every trade, every
-- event (including every announcement that was sent, which stays in signal_events), every audit entry.

BEGIN;

DROP INDEX IF EXISTS push_deliveries_accepted_idx;
ALTER TABLE push_deliveries DROP COLUMN IF EXISTS opened_at;
ALTER TABLE users DROP COLUMN IF EXISTS onboarded_at;
DROP INDEX IF EXISTS sessions_installation_idx;
ALTER TABLE sessions DROP COLUMN IF EXISTS installation_id;
DROP TABLE IF EXISTS device_bindings;
DROP TABLE IF EXISTS announcement_templates;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS notification_reads;
DROP TABLE IF EXISTS user_hidden_items;
DROP TABLE IF EXISTS trade_archives;
DROP TRIGGER IF EXISTS signal_events_activity ON signal_events;
DROP FUNCTION IF EXISTS signal_events_track_activity();
DROP INDEX IF EXISTS trades_last_activity_seq_idx;
ALTER TABLE trades DROP COLUMN IF EXISTS last_activity_seq;
ALTER TABLE instruments DROP COLUMN IF EXISTS archived_at;
ALTER TABLE instruments DROP COLUMN IF EXISTS exchange;
DELETE FROM _prisma_migrations WHERE migration_name = '20261108000000_mobile_experience';

COMMIT;
