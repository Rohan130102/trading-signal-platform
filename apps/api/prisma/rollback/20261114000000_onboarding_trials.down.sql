-- Reverses 20261114000000_onboarding_trials. Run inside one transaction, after taking a backup, and only with
-- the application stopped and rolled back to the previous release:
--
--   psql "$DATABASE_URL" --single-transaction -f prisma/rollback/20261114000000_onboarding_trials.down.sql
--
-- It refuses to run while an upcoming range trade (one with no stop-loss yet) exists, because the previous
-- release cannot represent one: activate or cancel those first.
--
-- What is lost: sign-up details (names, age, verification and enquiry status), trial grants and their welcome
-- state, enquiry records, outgoing email records, email codes, password reset requests, personal notices and
-- their pushes, the support contact settings, and which access windows were trials (they become ordinary
-- subscriptions with the same dates, so nobody loses access). Self-registered accounts stay and keep working.
-- What is kept: every account, subscription, subscription event, trade, signal event, closure and audit entry.
-- The two new subscription event types stay in the enum, which PostgreSQL cannot shrink; the previous release
-- never writes them.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM trades WHERE status <> 'DRAFT' AND stop_loss IS NULL) THEN
    RAISE EXCEPTION 'Upcoming range trades exist. Activate or cancel them before rolling back.';
  END IF;
END $$;

ALTER TABLE trades DROP CONSTRAINT trades_published_is_complete;
ALTER TABLE trades ADD CONSTRAINT trades_published_is_complete CHECK (
  status = 'DRAFT' OR (
    ref IS NOT NULL AND instrument_id IS NOT NULL AND instrument_spec IS NOT NULL
    AND direction IS NOT NULL AND entry_type IS NOT NULL AND entry_low IS NOT NULL
    AND entry_high IS NOT NULL AND stop_loss IS NOT NULL AND original_stop_loss IS NOT NULL
    AND published_at IS NOT NULL AND jsonb_array_length(targets) > 0
  ));

DELETE FROM push_deliveries WHERE notice_id IS NOT NULL;
ALTER TABLE push_deliveries DROP CONSTRAINT IF EXISTS push_deliveries_one_source;
DROP INDEX IF EXISTS push_deliveries_notice_id_push_subscription_id_key;
ALTER TABLE push_deliveries DROP COLUMN IF EXISTS notice_id;
ALTER TABLE push_deliveries ALTER COLUMN event_id SET NOT NULL;

DROP TABLE IF EXISTS user_notices;
DROP TABLE IF EXISTS password_reset_requests;
DROP TABLE IF EXISTS email_challenges;
DROP TABLE IF EXISTS subscription_enquiries;
DROP TABLE IF EXISTS email_outbox;
DROP TABLE IF EXISTS trial_grants;

ALTER TABLE subscriptions DROP COLUMN IF EXISTS kind;
ALTER TABLE app_settings DROP COLUMN IF EXISTS support_whatsapp, DROP COLUMN IF EXISTS support_email;

DROP INDEX IF EXISTS users_email_lower_idx;
DROP INDEX IF EXISTS users_self_registered_idx;
DROP INDEX IF EXISTS users_verified_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_verified_has_email;
ALTER TABLE users
  DROP COLUMN IF EXISTS first_name,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS age,
  DROP COLUMN IF EXISTS email_verified_at,
  DROP COLUMN IF EXISTS self_registered_at,
  DROP COLUMN IF EXISTS privacy_accepted_at,
  DROP COLUMN IF EXISTS registration_seen_at,
  DROP COLUMN IF EXISTS enquiry_status,
  DROP COLUMN IF EXISTS enquiry_updated_at;

-- Kept, because published events may refer to it; switched off so nothing new uses it.
UPDATE signal_templates SET active = false, is_default = false WHERE kind = 'UPCOMING_TRADE';

DELETE FROM _prisma_migrations WHERE migration_name = '20261114000000_onboarding_trials';

COMMIT;
