-- Settings the Super Admin manages from the configuration screen instead of a code or server change: whether
-- people may sign themselves up, the usual free-trial length, and the email account that sends sign-up codes
-- and account emails.
-- Additive: new columns with defaults that keep today's behaviour (sign-up open, email from the server's own
-- configuration until details are entered here). The reverse script is
-- prisma/rollback/20261115000000_configuration.down.sql.

ALTER TABLE app_settings
  ADD COLUMN signup_open BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN default_trial_days INTEGER NOT NULL DEFAULT 7 CHECK (default_trial_days BETWEEN 1 AND 90),
  -- The SMTP account. The password is encrypted with APP_ENCRYPTION_KEY and never returned by the API.
  ADD COLUMN email_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN smtp_host TEXT NOT NULL DEFAULT '',
  ADD COLUMN smtp_port INTEGER NOT NULL DEFAULT 587 CHECK (smtp_port BETWEEN 1 AND 65535),
  ADD COLUMN smtp_security TEXT NOT NULL DEFAULT 'STARTTLS' CHECK (smtp_security IN ('STARTTLS', 'TLS')),
  ADD COLUMN smtp_username TEXT NOT NULL DEFAULT '',
  ADD COLUMN smtp_password_enc TEXT,
  ADD COLUMN email_from_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN email_from_address TEXT NOT NULL DEFAULT '',
  -- When a test email was last accepted with these details. Cleared when they change.
  ADD COLUMN email_tested_at TIMESTAMPTZ(3),
  ADD CONSTRAINT app_settings_email_complete
    CHECK (NOT email_enabled OR (smtp_host <> '' AND email_from_address <> ''));
