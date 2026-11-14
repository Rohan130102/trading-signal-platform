# Database

PostgreSQL. Schema: `apps/api/prisma/schema.prisma`. Migrations: `apps/api/prisma/migrations`. Apply with `npm run db:migrate`.

## Relationships

```
User ─┬─ Session ── PushSubscription ── PushDelivery ── SignalEvent
      ├─ Subscription ── SubscriptionEvent (append-only)
      ├─ MfaRecoveryCode, NotificationPreference
      └─ AuditLog (append-only)

Instrument ── Trade ─┬─ SignalEvent (append-only) ── OutboxEvent, FanoutMetric
SignalTemplate ──────┤
                     ├─ TradeClosure (immutable, correction supersedes)
                     └─ TradeExecutionRecord (append-only)

AppSettings (single row), PublicPerformanceApproval, RateLimitBucket, WorkerHeartbeat
```

## Tables that matter most

| Table                     | Purpose                                                                       | Notes                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signal_events`           | The record of everything said about a trade, plus announcements.              | Append-only. `seq`, `created_at`, `prev_hash` and `hash` are set by a trigger and cannot be supplied. Stores the exact title and body sent, and the structured values. |
| `trades`                  | Current projection of a signal.                                               | Updated in the same transaction as its event. `version` provides optimistic locking. `instrument_spec` freezes the configuration at publication.                       |
| `trade_closures`          | Each exit: inputs, results, methodology version.                              | Only change allowed: gaining `superseded_by_event_id`, once.                                                                                                           |
| `outbox_events`           | One job per broadcast event.                                                  | Written in the event's transaction.                                                                                                                                    |
| `push_deliveries`         | One row per event per device.                                                 | `UNIQUE(event_id, push_subscription_id)` makes fan-out idempotent.                                                                                                     |
| `subscriptions`           | Current entitlement.                                                          | `UNIQUE(user_id)` prevents duplicates.                                                                                                                                 |
| `audit_logs`              | Who did what.                                                                 | Append-only.                                                                                                                                                           |
| `announcements`           | Editable announcement records: draft, scheduled, published, archived, binned. | Publishing appends one `ANNOUNCEMENT` event in the same transaction (idempotency key `announcement:<id>`). Only never-sent rows can be deleted.                        |
| `trade_archives`          | Finished trades an administrator moved out of the Signals list.               | A row per trade. The trade and its events are untouched; removing the row restores it.                                                                                 |
| `trade_removals`          | Finished trades the Master Admin took off every subscriber screen.            | A row per trade, with who and why (at least 5 characters). Still counted in every performance figure. Removing the row restores it.                                    |
| `user_hidden_items`       | What one subscriber hid from their own lists.                                 | Primary key `(user_id, item_type, item_id)`. Affects nobody else.                                                                                                      |
| `notification_reads`      | Single notifications opened, on top of `users.last_read_seq`.                 | Unread = after the marker and not in this table. The list, the tab and the app badge use the same rule.                                                                |
| `device_bindings`         | One subscriber per app installation.                                          | Partial unique index on `installation_id` where not released, so concurrent sign-ins cannot bind twice. Released rows stay as history.                                 |
| `email_challenges`        | Email ownership checks for sign-up and recovery.                              | Only a keyed hash of each code. Details typed at sign-up are cleared when the account is created, and every row is deleted after a day.                                |
| `email_outbox`            | Outgoing email other than codes.                                              | Written in the transaction of the change it reports. `SENT` means the provider accepted it. Unique `dedupe_key`.                                                       |
| `subscription_enquiries`  | Each enquiry and how it was made.                                             | An email enquiry links to its `email_outbox` row, so its outcome is the provider's answer, never assumed.                                                              |
| `trial_grants`            | Free trials an administrator granted.                                         | Separate from paid history for reporting. `acknowledged_at` makes the welcome show once across devices.                                                                |
| `password_reset_requests` | Recovery requests from proved addresses.                                      | Partial unique index: one open request per person.                                                                                                                     |
| `user_notices`            | Messages to one person about their own account.                               | Unique `dedupe_key`. A push carries either a signal event or a notice (`push_deliveries_one_source`).                                                                  |

## Guarantees enforced by the database

Application code cannot bypass these. See migration `20261105000100_integrity`.

| Guarantee                          | Mechanism                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events cannot be edited or deleted | Trigger `reject_mutation` on UPDATE, DELETE and TRUNCATE. Same for `audit_logs`; UPDATE and DELETE for `subscription_events` and `trade_execution_records`                                                                                                                      |
| Exit records are immutable         | Trigger `trade_closures_guard`                                                                                                                                                                                                                                                  |
| Commit-ordered sequence            | `signal_events_before_insert` holds an advisory lock from assignment until commit                                                                                                                                                                                               |
| Server-set timestamps              | The same trigger overwrites `created_at`                                                                                                                                                                                                                                        |
| Tamper evidence                    | SHA-256 chain over each event and its predecessor. Check with `SELECT * FROM verify_signal_event_chain()`, or the Audit log page                                                                                                                                                |
| Published signals are complete     | `trades_published_is_complete`                                                                                                                                                                                                                                                  |
| Sensible values                    | `trades_entry_ordered`, `trades_prices_positive`, `trades_fraction_bounds`, `trade_closures_fraction_bounds`, `trade_closures_exit_positive`, `trade_closures_money_needs_quantity`, `subscriptions_window_valid`, `instruments_sizes_positive`, `instruments_precision_bounds` |
| One default template per kind      | Partial unique index                                                                                                                                                                                                                                                            |
| One settings row                   | `app_settings_singleton`                                                                                                                                                                                                                                                        |
| No duplicate logical actions       | Unique `idempotency_key` on `signal_events` and `subscription_events`                                                                                                                                                                                                           |
| UTC sessions                       | `ALTER DATABASE … SET timezone`, plus per-connection `TimeZone=UTC`                                                                                                                                                                                                             |

The hash chain detects tampering. It does not prevent it: someone with superuser access could rewrite the whole chain. For
stronger evidence, periodically store the latest `hash` somewhere outside this database.

## Numbers

| Column kind            | Type                         |
| ---------------------- | ---------------------------- |
| Prices, quantities     | `NUMERIC(24,8)`              |
| Fraction of a position | `NUMERIC(24,12)`             |
| Gross and net P&L      | `NUMERIC(28,8)`              |
| Timestamps             | `TIMESTAMPTZ(3)`, always UTC |

Figures are computed with `decimal.js` and rounded to the column's scale before storage, so what is computed is exactly what is stored.

## Calculated values that are stored

Each `trade_closures` row keeps its results (`price_move`, `points`, `gross_pnl`, `net_pnl`) with the inputs that produced
them (`entry_price_used`, `exit_price`, `quantity`, `multiplier_used`, `fees`) and `methodology_version`. A later change in
formula cannot silently reinterpret an old result. Aggregates across exits are always computed, never stored.

`trades.last_activity_seq` is kept by an `AFTER INSERT` trigger on `signal_events`, so the Signals list can order by the
latest change and page with a cursor. It runs while the writer already holds the trade's row lock.

## Migrations and rollback

Migrations are additive. `20261114000000_onboarding_trials` adds the sign-up, enquiry, trial, recovery and notice
tables, three subscription columns and lets a range trade be published before its levels; its rollback refuses to run
while such a trade is waiting, and keeps every account. `20261108000000_mobile_experience` adds tables and columns only and backfills an announcement
record for every announcement already sent. To reverse it, stop the application, take a backup, roll the code back,
and run `apps/api/prisma/rollback/20261108000000_mobile_experience.down.sql` in one transaction. That removes drafts,
schedules, hidden items, bindings and read marks; every trade, event and audit entry stays.

## Retention

| Data                                                                 | Kept                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| Events, closures, execution records, audit log, subscription history | Indefinitely. Confirm against your legal requirement. |
| Live-delivery metrics                                                | 30 days                                               |
| Finished push delivery rows                                          | 90 days                                               |
| Expired sessions with no linked device                               | 90 days after expiry                                  |
| Rate-limit counters, worker heartbeats                               | 1 day                                                 |
| Email checks, with anything typed at sign-up                         | 1 day                                                 |
| Sent or failed emails not linked to an enquiry                       | 90 days                                               |

## Least privilege

Migrations run as the owner. The application should use a separate role that cannot alter the schema, drop triggers or
truncate tables: see `deploy/app-role.sql`.

## Backup and restore

See [DEPLOYMENT.md](DEPLOYMENT.md#backup-and-restore).
