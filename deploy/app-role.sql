-- Least privilege: migrations run as the owner, the application runs as this role. It can read and
-- write data but cannot change the schema, drop the triggers that make history append-only, or
-- truncate tables. Set the password yourself, for example through your secret manager.
--   psql "$OWNER_DATABASE_URL" -v app_password="'...'" -f deploy/app-role.sql
CREATE ROLE signaldesk_app LOGIN PASSWORD :app_password;
GRANT CONNECT ON DATABASE signaldesk TO signaldesk_app;
GRANT USAGE ON SCHEMA public TO signaldesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO signaldesk_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO signaldesk_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO signaldesk_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM signaldesk_app;
-- Applies to what later migrations create. Run those as the same owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO signaldesk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO signaldesk_app;
