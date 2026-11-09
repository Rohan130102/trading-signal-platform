-- Master Admin, platform rules kept in the database instead of the code, removing finished trades from
-- subscriber screens, and per-subscriber screenshot permission.
-- No trade, event, closure or audit entry is changed or removed. One settings column changes unit (hours
-- to minutes) and its value is carried over in this same migration. The reverse script is
-- prisma/rollback/20261109000000_master_admin_controls.down.sql.

-- Master Admin: an administrator who alone registers and manages other administrators and changes platform
-- rules. Always an administrator.
ALTER TABLE users ADD COLUMN is_master_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT users_master_admin_is_admin CHECK (NOT is_master_admin OR role = 'ADMIN');

-- Screenshot permission for one subscriber. NULL follows the platform default.
ALTER TABLE users ADD COLUMN screenshots_allowed BOOLEAN;
ALTER TABLE users ADD CONSTRAINT users_screenshots_subscriber CHECK (screenshots_allowed IS NULL OR role = 'SUBSCRIBER');

-- An existing installation must not lose the ability to manage administrators: the longest-serving active
-- administrator becomes the Master Admin. Recorded in the audit log.
UPDATE users SET is_master_admin = true
WHERE id = (
    SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY created_at ASC, id ASC LIMIT 1
  )
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_master_admin);
INSERT INTO audit_logs (action, target_type, target_id, metadata)
SELECT 'MASTER_ADMIN_ASSIGNED', 'user', id::text,
  '{"source": "migration", "reason": "Longest-serving active administrator"}'::jsonb
FROM users WHERE is_master_admin;

-- Platform rules.
ALTER TABLE app_settings
  ADD COLUMN signal_start_mode TEXT NOT NULL DEFAULT 'AWAITING_ENTRY'
    CHECK (signal_start_mode IN ('AWAITING_ENTRY', 'ACTIVE')),
  ADD COLUMN entry_expiry_minutes_default INTEGER NOT NULL DEFAULT 240
    CHECK (entry_expiry_minutes_default BETWEEN 0 AND 43200),
  ADD COLUMN trailing_stop_wording TEXT NOT NULL DEFAULT 'GENERAL'
    CHECK (trailing_stop_wording IN ('GENERAL', 'DETAILED')),
  ADD COLUMN screenshots_allowed_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN history_scope TEXT NOT NULL DEFAULT 'MEMBERSHIP' CHECK (history_scope IN ('MEMBERSHIP', 'ALL')),
  ADD COLUMN about_body TEXT NOT NULL DEFAULT '',
  ADD COLUMN data_reset_at TIMESTAMPTZ(3);

-- The entry window is now set in minutes, because intraday signals need windows shorter than an hour. A
-- configured number of hours carries over exactly. "No limit" (0), the old default, becomes four hours:
-- signals that never become active must now be cancelled automatically. The Master Admin can change it.
UPDATE app_settings SET entry_expiry_minutes_default =
  CASE WHEN entry_expiry_hours_default > 0 THEN LEAST(entry_expiry_hours_default * 60, 43200) ELSE 240 END;
ALTER TABLE app_settings DROP COLUMN entry_expiry_hours_default;

-- A finished trade the Master Admin took off every subscriber screen. The trade and all its events stay;
-- administrators still see it, the audit log records who did it and why, and performance figures keep
-- counting it, so removing a losing trade can never improve the results. Removing the row restores it.
CREATE TABLE trade_removals (
  trade_id UUID PRIMARY KEY REFERENCES trades(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  removed_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  removed_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 5)
);

-- History visibility looks up when a trade closed.
CREATE INDEX trades_closed_at_idx ON trades (closed_at) WHERE closed_at IS NOT NULL;
