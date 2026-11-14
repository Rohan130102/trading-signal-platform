-- Self-registration with email verification, subscription enquiries, administrator-granted free trials,
-- administrator-managed password recovery, personal account notices, and range trades announced before
-- their levels exist.
-- Additive: no account, subscription, trade, event, closure or audit entry is removed or rewritten. Existing
-- accounts keep their login IDs and passwords. The reverse script is
-- prisma/rollback/20261114000000_onboarding_trials.down.sql.

-- Who registered themselves, with what details, and whether they proved the address. Identity, enquiry
-- progress and access are separate facts and are kept in separate columns.
ALTER TABLE users
  ADD COLUMN first_name TEXT,
  ADD COLUMN last_name TEXT,
  ADD COLUMN age INTEGER CHECK (age IS NULL OR age BETWEEN 18 AND 120),
  ADD COLUMN email_verified_at TIMESTAMPTZ(3),
  ADD COLUMN self_registered_at TIMESTAMPTZ(3),
  ADD COLUMN privacy_accepted_at TIMESTAMPTZ(3),
  ADD COLUMN registration_seen_at TIMESTAMPTZ(3),
  ADD COLUMN enquiry_status TEXT NOT NULL DEFAULT 'NOT_CONTACTED'
    CHECK (enquiry_status IN ('NOT_CONTACTED', 'INITIATED', 'UNDER_DISCUSSION', 'RESOLVED')),
  ADD COLUMN enquiry_updated_at TIMESTAMPTZ(3);
ALTER TABLE users ADD CONSTRAINT users_verified_has_email CHECK (email_verified_at IS NULL OR email IS NOT NULL);

-- Subscribers an administrator already set up have nothing left to enquire about.
UPDATE users SET enquiry_status = 'RESOLVED'
WHERE role = 'SUBSCRIBER' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = users.id);

-- One verified account per address. Older accounts have no verified address, so nothing existing can clash;
-- addresses shared by older accounts are left as they are (see docs/ENHANCEMENTS.md).
CREATE UNIQUE INDEX users_verified_email_key ON users (lower(email)) WHERE email_verified_at IS NOT NULL;
CREATE INDEX users_self_registered_idx ON users (self_registered_at DESC) WHERE self_registered_at IS NOT NULL;
CREATE INDEX users_email_lower_idx ON users (lower(email));

-- Support contact, set by the Master Admin and read by every screen and email.
ALTER TABLE app_settings
  ADD COLUMN support_whatsapp TEXT NOT NULL DEFAULT '+919987255414',
  ADD COLUMN support_email TEXT NOT NULL DEFAULT 'singhrohan130102@gmail.com';

-- What the current access window is. Every existing subscription was paid for.
ALTER TABLE subscriptions ADD COLUMN kind TEXT NOT NULL DEFAULT 'PAID' CHECK (kind IN ('PAID', 'TRIAL'));
ALTER TYPE "SubscriptionEventType" ADD VALUE IF NOT EXISTS 'STARTED';
ALTER TYPE "SubscriptionEventType" ADD VALUE IF NOT EXISTS 'TRIAL_GRANTED';

-- Free trials, kept apart from paid history for reporting. Never created by registration itself.
CREATE TABLE trial_grants (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 90),
  starts_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  note TEXT,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  -- Set once the welcome was shown on any device, so it is never shown again.
  acknowledged_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT trial_grants_window_valid CHECK (expires_at > starts_at)
);
CREATE INDEX trial_grants_user_idx ON trial_grants (user_id, created_at DESC);

-- Outgoing email other than sign-in codes, which are sent at once and never stored. SENT means the provider
-- accepted the message; arrival is not observable.
CREATE TABLE email_outbox (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  to_address TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ(3),
  provider_message_id TEXT,
  last_error TEXT,
  dedupe_key TEXT UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ(3)
);
CREATE INDEX email_outbox_due_idx ON email_outbox (status, next_attempt_at) WHERE status IN ('PENDING', 'SENDING');

-- Each time someone asked about a subscription, and how. A WhatsApp enquiry only records that the link was
-- opened; an email enquiry links to the message and so to whether the provider accepted it.
CREATE TABLE subscription_enquiries (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('WHATSAPP', 'EMAIL')),
  purpose TEXT NOT NULL CHECK (purpose IN ('SUBSCRIPTION', 'RENEWAL')),
  whatsapp_unavailable BOOLEAN NOT NULL DEFAULT false,
  email_id BIGINT REFERENCES email_outbox(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT subscription_enquiries_email_link CHECK ((channel = 'EMAIL') = (email_id IS NOT NULL))
);
CREATE INDEX subscription_enquiries_user_idx ON subscription_enquiries (user_id, created_at DESC);

-- Email ownership checks for sign-up and password recovery. Only a keyed hash of a code is kept. Details typed
-- at sign-up stay here until the address is proved, and are cleared by the worker after a day.
CREATE TABLE email_challenges (
  id UUID PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('REGISTRATION', 'PASSWORD_RESET')),
  email TEXT NOT NULL,
  -- The existing account this concerns: the one being recovered, or the one an address already belongs to.
  user_id UUID REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  details JSONB,
  code_hash TEXT,
  code_expires_at TIMESTAMPTZ(3),
  attempts INTEGER NOT NULL DEFAULT 0,
  send_count INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ(3),
  verified_at TIMESTAMPTZ(3),
  setup_token_hash TEXT UNIQUE,
  setup_expires_at TIMESTAMPTZ(3),
  consumed_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX email_challenges_email_idx ON email_challenges (purpose, email, created_at DESC);
CREATE INDEX email_challenges_created_idx ON email_challenges (created_at);

-- Recovery requests from people who proved their address. An administrator issues a temporary password.
CREATE TABLE password_reset_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  email TEXT NOT NULL,
  verified_at TIMESTAMPTZ(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PASSWORD_ISSUED', 'COMPLETED', 'DISMISSED')),
  issued_at TIMESTAMPTZ(3),
  issued_by_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  completed_at TIMESTAMPTZ(3),
  completed_by_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX password_reset_requests_one_open ON password_reset_requests (user_id)
  WHERE status IN ('OPEN', 'PASSWORD_ISSUED');
CREATE INDEX password_reset_requests_status_idx ON password_reset_requests (status, created_at DESC);

-- Messages to one person about their own account. They reach people whose signal access has ended, because
-- they carry no signal content.
CREATE TABLE user_notices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ(3)
);
CREATE INDEX user_notices_user_idx ON user_notices (user_id, created_at DESC);

-- A push now carries either a signal event or a personal notice, never both. Existing rows all carry an event.
ALTER TABLE push_deliveries ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE push_deliveries ADD COLUMN notice_id UUID REFERENCES user_notices(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE push_deliveries ADD CONSTRAINT push_deliveries_one_source CHECK ((event_id IS NULL) <> (notice_id IS NULL));
CREATE UNIQUE INDEX push_deliveries_notice_id_push_subscription_id_key ON push_deliveries (notice_id, push_subscription_id);

-- A range signal may be announced before its levels exist. It has no stop-loss or target until it is
-- activated, may never be active without them, and every other published trade is unchanged.
ALTER TABLE trades DROP CONSTRAINT trades_published_is_complete;
ALTER TABLE trades ADD CONSTRAINT trades_published_is_complete CHECK (
  status = 'DRAFT' OR (
    ref IS NOT NULL AND instrument_id IS NOT NULL AND instrument_spec IS NOT NULL
    AND direction IS NOT NULL AND entry_type IS NOT NULL AND entry_low IS NOT NULL
    AND entry_high IS NOT NULL AND published_at IS NOT NULL
    AND (
      (stop_loss IS NOT NULL AND original_stop_loss IS NOT NULL AND jsonb_array_length(targets) > 0)
      OR (
        entry_type = 'RANGE' AND activated_at IS NULL AND status IN ('PUBLISHED', 'CANCELLED', 'EXPIRED')
        AND stop_loss IS NULL AND original_stop_loss IS NULL AND jsonb_array_length(targets) = 0
      )
    )
  ));

-- Wording. Only templates still exactly as shipped are changed; anything an administrator edited is kept.
INSERT INTO signal_templates (id, kind, name, tone, title, body, is_default, active, favorite, created_at, updated_at)
VALUES (gen_random_uuid(), 'UPCOMING_TRADE', 'Upcoming trade', 'NEUTRAL', 'Upcoming trade: {{direction}} {{instrument}}',
  E'Entry zone: {{entry}}\nAwaiting activation\n{{comment}}', true, true, false, now(), now())
ON CONFLICT (kind, name) DO NOTHING;
UPDATE signal_templates
SET title = 'Trade active: {{direction}} {{instrument}}',
    body = E'Entry: {{entry}}\nTarget 1: {{target1}}\nTarget 2: {{target2}}\nTarget 3: {{target3}}\nStop-loss: {{stop}}\n{{comment}}',
    updated_at = now()
WHERE kind = 'ENTRY_ACTIVATED' AND name = 'Entry activated'
  AND title = 'Entry active: {{direction}} {{instrument}}'
  AND body = E'Trade {{ref}} is now active.\nStop-loss: {{stop}}\n{{comment}}';
UPDATE signal_templates
SET title = 'Updated: {{direction}} {{instrument}}', body = '{{changes}}', updated_at = now()
WHERE kind = 'CORRECTION' AND name = 'Correction'
  AND title = 'Correction: {{direction}} {{instrument}}'
  AND body = E'Correction to trade {{ref}}: {{changes}}\nReason: {{reason}}';
