-- Mobile experience: grouped signals, per-subscriber hiding, announcements with a lifecycle, archived
-- trades, one subscriber per app installation, read state and notification timing.
-- Additive only: no existing column changes type and no existing row is removed. The reverse script is
-- prisma/rollback/20261108000000_mobile_experience.down.sql.

-- Instruments: where they trade, and retiring one without touching its trades.
ALTER TABLE instruments ADD COLUMN exchange TEXT;
ALTER TABLE instruments ADD COLUMN archived_at TIMESTAMPTZ(3);

-- Trades: the position of the latest broadcast event, so the Signals list can order by activity and page
-- with a cursor. Kept by the database, so no write path can forget it.
ALTER TABLE trades ADD COLUMN last_activity_seq BIGINT;
UPDATE trades t
SET last_activity_seq = e.max_seq
FROM (
  SELECT trade_id, max(seq) AS max_seq FROM signal_events
  WHERE broadcast AND trade_id IS NOT NULL GROUP BY trade_id
) e
WHERE e.trade_id = t.id;
CREATE INDEX trades_last_activity_seq_idx ON trades (last_activity_seq DESC) WHERE status <> 'DRAFT';

-- Runs while the event's transaction already holds the trade's row lock (every writer locks the trade
-- before appending), so it takes no new lock and cannot change the lock order.
CREATE FUNCTION signal_events_track_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE trades SET last_activity_seq = GREATEST(COALESCE(last_activity_seq, 0), NEW.seq)
  WHERE id = NEW.trade_id;
  RETURN NULL;
END $$;
CREATE TRIGGER signal_events_activity AFTER INSERT ON signal_events
  FOR EACH ROW WHEN (NEW.trade_id IS NOT NULL AND NEW.broadcast)
  EXECUTE FUNCTION signal_events_track_activity();

-- An administrator moving a finished trade out of the Signals list. The trade and its events are
-- untouched; it stays in History. Removing the row restores it.
CREATE TABLE trade_archives (
  trade_id UUID PRIMARY KEY REFERENCES trades(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  archived_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  archived_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  reason TEXT
);

-- A subscriber hiding something from their own lists. Never affects anyone else, never deletes anything.
CREATE TABLE user_hidden_items (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('TRADE', 'ANNOUNCEMENT')),
  item_id UUID NOT NULL,
  hidden_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_type, item_id)
);

-- Read state for single notifications, on top of users.last_read_seq (everything up to it is read).
CREATE TABLE notification_reads (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  event_id UUID NOT NULL REFERENCES signal_events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  read_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

-- Announcements as editable records. Publishing appends an ANNOUNCEMENT event that is never changed.
CREATE TABLE announcements (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'GENERAL'
    CHECK (category IN ('GENERAL', 'IMPORTANT', 'MARKET_UPDATE', 'MAINTENANCE', 'EDUCATIONAL', 'URGENT')),
  priority "Priority" NOT NULL DEFAULT 'NORMAL',
  pinned BOOLEAN NOT NULL DEFAULT false,
  link_url TEXT CHECK (link_url IS NULL OR link_url LIKE 'https://%'),
  link_label TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED')),
  publish_at TIMESTAMPTZ(3),
  published_at TIMESTAMPTZ(3),
  edited_at TIMESTAMPTZ(3),
  expires_at TIMESTAMPTZ(3),
  archived_at TIMESTAMPTZ(3),
  deleted_at TIMESTAMPTZ(3),
  event_id UUID UNIQUE REFERENCES signal_events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  idempotency_key TEXT UNIQUE,
  version INTEGER NOT NULL DEFAULT 0,
  created_by_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  updated_by_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT announcements_scheduled_has_time CHECK (status <> 'SCHEDULED' OR publish_at IS NOT NULL),
  CONSTRAINT announcements_sent_has_event CHECK (status NOT IN ('PUBLISHED', 'ARCHIVED') OR event_id IS NOT NULL)
);
CREATE INDEX announcements_visible_idx ON announcements (pinned DESC, published_at DESC)
  WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE INDEX announcements_due_idx ON announcements (publish_at) WHERE status = 'SCHEDULED' AND deleted_at IS NULL;

-- Announcements sent before this table existed keep their place: one record per existing event.
INSERT INTO announcements (id, title, body, category, priority, status, published_at, event_id, created_by_id,
                           created_at, updated_at)
SELECT gen_random_uuid(), e.title, COALESCE(e.payload->>'message', e.body),
       CASE WHEN e.priority = 'PRIORITY' THEN 'IMPORTANT' ELSE 'GENERAL' END,
       e.priority, 'PUBLISHED', e.created_at, e.id, e.actor_id, e.created_at, e.created_at
FROM signal_events e
WHERE e.type = 'ANNOUNCEMENT';

CREATE TABLE announcement_templates (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL
    CHECK (category IN ('GENERAL', 'IMPORTANT', 'MARKET_UPDATE', 'MAINTENANCE', 'EDUCATIONAL', 'URGENT')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- One subscriber per app installation. A released binding stays as history; only one may be current.
CREATE TABLE device_bindings (
  id UUID PRIMARY KEY,
  installation_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  platform TEXT,
  device_label TEXT,
  bound_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ(3),
  released_by_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  release_reason TEXT
);
CREATE UNIQUE INDEX device_bindings_current_idx ON device_bindings (installation_id) WHERE released_at IS NULL;
CREATE INDEX device_bindings_user_id_released_at_idx ON device_bindings (user_id, released_at);

ALTER TABLE sessions ADD COLUMN installation_id TEXT;
CREATE INDEX sessions_installation_idx ON sessions (installation_id) WHERE installation_id IS NOT NULL;

-- First-use tour.
ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ(3);

-- When a notification was opened on a phone. Only an open is observable; arrival is not.
ALTER TABLE push_deliveries ADD COLUMN opened_at TIMESTAMPTZ(3);
CREATE INDEX push_deliveries_accepted_idx ON push_deliveries (accepted_at) WHERE accepted_at IS NOT NULL;
