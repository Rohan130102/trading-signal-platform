# Architecture

SignalDesk is a **modular monolith**: one NestJS API, one background worker (same codebase, separate
process), one Next.js web app and one PostgreSQL database. It communicates signals. It never places
orders, connects to brokers for execution, or assumes that a subscriber acted on anything.

```
Browser (PWA) ──HTTPS──▶ Reverse proxy (Caddy) ─┬─▶ web  (Next.js)         pages only, holds no data
      │                                         ├─▶ api  (NestJS) /api/*   REST + authorization
      └───────────WSS /ws───────────────────────┘        │  /ws            live event stream
                                                         ▼
Push services ◀──Web Push── worker (NestJS) ◀──▶ PostgreSQL ◀──────────────┘
```

## Repository layout

| Path              | Purpose                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/domain` | Pure TypeScript: decimal maths, level calculation, state machine, P&L, subscription rules, template rendering, request schemas, response types. No I/O. Used by the API and the web app, so the composer preview and the server cannot disagree. |
| `apps/api`        | REST, WebSocket gateway, worker, Prisma schema and migrations.                                                                                                                                                                                   |
| `apps/web`        | All screens, service worker, PWA manifest.                                                                                                                                                                                                       |
| `e2e`             | Playwright journeys and accessibility checks.                                                                                                                                                                                                    |
| `scripts`         | Local database, environment setup, performance measurement.                                                                                                                                                                                      |

## Native app

`apps/mobile` is another client of the same API. It uses Expo Router for native navigation, TanStack Query for server state, and
`LiveConnection` from `packages/domain` for the same live stream the web uses. It has no trade logic of its own: `composeSignal`,
`previewExit`, `trailStopPrice`, `formatPrice` and the request schemas are the same code the server and web run. Native push is a
second channel in the existing outbox and delivery pipeline. See [MOBILE.md](MOBILE.md).

## Key decisions

| Decision         | Choice                                                               | Why                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Redis / BullMQ   | **Not used**                                                         | PostgreSQL already gives a durable transactional queue (`FOR UPDATE SKIP LOCKED`), cross-instance wake-ups (`LISTEN/NOTIFY`) and shared rate-limit counters. A second stateful service adds failure modes without a demonstrated need at this scale. The prompt allows Redis "when justified"; revisit if push volume outgrows the queue tables. |
| Event model      | Append-only `signal_events` + a projection on `trades`               | The history is the record. `decide()` builds events and folds them through `evolve()`, so stored state always equals the replay of its history (tested).                                                                                                                                                                                         |
| Event ordering   | A `BEFORE INSERT` trigger takes an advisory lock, then assigns `seq` | A plain sequence is not commit-ordered: B can take number 5 and commit before A's 4, and a client resuming from 5 would lose 4 forever. Holding the lock until commit makes `seq` safe for cursor recovery. Writes are low-volume admin actions, so serializing them is cheap.                                                                   |
| Live delivery    | Gateway tails the committed event log                                | In-app delivery does not depend on the worker: a push outage cannot delay the feed. This deliberately differs from the brief's "worker → live event" ordering, because it removes a failure dependency and a hop.                                                                                                                                |
| Sessions         | Opaque token in an `HttpOnly` cookie; only its SHA-256 is stored     | Immediate revocation, nothing readable by page scripts. Access is decided from the database on every request, never from a claim inside a token.                                                                                                                                                                                                 |
| Access rule      | One function, `evaluateSignalAccess`                                 | REST guard, WebSocket gateway and push worker all call it, so they cannot drift apart.                                                                                                                                                                                                                                                           |
| Financial values | `NUMERIC` in the database, strings on the wire, `decimal.js` in code | No binary floating point touches a price.                                                                                                                                                                                                                                                                                                        |
| UTC              | Forced per connection and per database                               | The Prisma driver sends timestamps without an offset. On a non-UTC server, stored instants silently shift, and a read-back hides it. Found by a test on an IST machine; see migration `20261105000200_utc`.                                                                                                                                      |
| API docs         | Generated from controllers and the Zod validators                    | The document cannot drift from what the server enforces. Served at `/api/v1/openapi.json`, exported to `docs/openapi.json`.                                                                                                                                                                                                                      |

## Publishing a signal

1. The composer computes levels locally with the shared domain code. The server recomputes and revalidates everything; it trusts nothing from the client.
2. In one transaction: the trade row, the `SIGNAL_PUBLISHED` event (exact rendered text and structured values), its outbox row and an audit record. `pg_notify` fires at commit.
3. The gateway wakes, loads events after its head and advances each connection's cursor. A 3-second poll backstops a lost notification.
4. The worker claims the outbox row, expands it into one `push_deliveries` row per eligible device (the unique key makes a repeat harmless), and sends with bounded retries.
5. Each result is recorded. The dashboard reports "accepted by the push service" and never "delivered".

## Trade state machine

```
DRAFT ──publish──▶ PUBLISHED ──activate──▶ ACTIVE ──partial──▶ PARTIALLY_CLOSED
                     │   │                   │                        │
                  cancel expire            close                    close
                     ▼   ▼                   ▼                        ▼
             CANCELLED  EXPIRED           CLOSED ◀────────────────────┘
```

Only an `ACTIVATE` action moves a signal to `ACTIVE`. A new signal starts as the Master Admin's platform setting says:
**awaiting entry** (the default) or **active immediately**, and the administrator can choose either when publishing
(`activateOnPublish`). Awaiting entry, it has an entry window (default four hours, set in minutes; a publish can give its
own end time or none). When the window ends first, the worker's sweep (every 15 seconds) expires it with a broadcast
`ENTRY_EXPIRED` event, so subscribers are told not to enter; one key per trade and version keeps several workers from
expiring it twice. Starting active applies `ACTIVATE` in the publish transaction as its own internal event, so
subscribers get one alert; it is never a fill and creates no execution record. Terminal states
have no way out. A closed trade's levels cannot change, but an exit can be corrected: a new closure
supersedes the old one, which is kept and flagged. See `packages/domain/src/status.ts` for the table of
which action is allowed from which state.

## Concurrency and idempotency

- Every trade command carries `expectedVersion`. The transaction takes a row lock, then checks the version, so a second administrator waits and is then told to refresh instead of overwriting.
- Every write that could be repeated carries an `idempotencyKey`, enforced by a unique index and re-checked under the lock, so parallel copies of one request produce one result.
- The composer derives its key from the form contents, so a double-click or a retry after a lost response cannot publish twice.

## Reliability

| Failure              | Behaviour                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Worker down          | Feed and live delivery unaffected. Push jobs wait in the outbox. Dashboard raises a critical alert. Restart resumes (tested with `SIGKILL`).                 |
| Worker crash mid-job | Claims expire after 60 s and are picked up again. Unique keys prevent duplicates; a repeated send collapses on the device through its notification tag.      |
| Several workers      | `SKIP LOCKED` shares work without double-sending (tested).                                                                                                   |
| Database outage      | `/health/ready` returns 503, requests fail with safe errors, connections recover; a retry with the same key publishes once (tested by stopping PostgreSQL).  |
| Lost `NOTIFY`        | Each consumer also polls.                                                                                                                                    |
| Client offline       | Reconnect sends its last sequence; the gateway replays from there, in order. The client de-duplicates by sequence.                                           |
| Slow client          | Past 2 MB of buffered data, the socket is dropped; the client recovers faster by resuming from its cursor.                                                   |
| Push service down    | Bounded exponential backoff (2 s to 5 min, 6 attempts). Past the one-hour TTL a trading push is dropped: an instruction hours late does more harm than none. |

## Access revocation

Renewal, adjustment, suspension, password reset and sign-out all emit `pg_notify('access_changes', userId)`
inside their transaction. Open sockets for that user re-check immediately. Separately, each socket
remembers its exact expiry instant, re-checks every 30 seconds and a sweep runs every 5 seconds, so
expiry takes effect with no administrator action. The push worker re-checks access immediately before
each send, so a job queued before revocation is dropped.

## Deployment topology

See [DEPLOYMENT.md](DEPLOYMENT.md). Long-lived WebSockets and a background worker rule out pure serverless
hosting for the API: it needs a persistent host or container platform. Horizontal scaling works without
code changes: each API instance tails the log independently, and workers share the queue.

## Extension points

| Future need                       | Where it plugs in                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| SMS or email                      | A second transport beside `PushTransport`; the outbox expansion already separates fan-out from sending.                |
| Payment gateway                   | A caller of `SubscribersService.renew`, which is already idempotent.                                                   |
| Broker or verified execution data | The `EXTERNALLY_VERIFIED` basis is reserved and unreachable through any admin action until such an integration exists. |
| Native apps                       | The REST and WebSocket contracts are client-agnostic.                                                                  |
| More admin roles                  | `Role` plus the `AdminOnly` decorator.                                                                                 |
| Higher push volume                | Replace the delivery loop with BullMQ behind the same outbox.                                                          |

## Master Admin and platform rules

One flag on an administrator account, `users.is_master_admin`, marks a Master Admin. The guard checks it on every request
from the database, like the role, through the `MasterOnly()` decorator. Only a Master Admin can:

- register administrators (temporary password shown once; password change and two-step verification required at first
  sign-in), suspend, disable, reactivate and reset them, and grant or remove Master Admin. There is always at least one
  active Master Admin: the rows are locked while this is checked, so two changes at once cannot remove the last one.
- change settings (`PUT /admin/settings`) and record or revoke public-performance approvals.
- remove finished trades from subscriber screens, and set a subscriber's screenshot permission.

The first administrator created with `npm run admin:create` becomes the Master Admin. The migration made the
longest-serving active administrator the Master Admin on an existing installation, and logged it. `npm run
admin:make-master -- <login>` is the break-glass route when no Master Admin can sign in.

Platform rules live in `app_settings`, so routine changes need no code: the start mode, the entry window, the trailing
stop wording (`GENERAL`, the new stop only; or `DETAILED`, with the distance in points), whether subscribers may take
screenshots, and the history scope. Each change is audited with its old and new value, and a `screen_refresh`
notification makes open apps read the rules again.

## What each subscriber sees

`AudienceService` applies two rules to every subscriber list, count and badge (Signals, History, Alerts, the event feed,
the trade page, unread counts and the push badge): trades removed from subscriber screens are left out with all their
alerts, and with the `MEMBERSHIP` history scope a subscriber's lists start when their membership did (published or still
live during it; live trades are always shown). A subscriber can clear finished trades from their own lists; that uses
`user_hidden_items` and changes nobody else's view. None of this touches trades, events or any figure.

## Removing a trade from subscriber screens

`trade_removals` holds one row per removed trade, like `trade_archives`. Only finished trades qualify, all or nothing,
with a reason and the typed word `REMOVE`. The audit entry records who, why, and each trade's outcome. Performance
figures, internal and public, keep counting removed trades, and the public page states how many there are, so removing a
losing trade can never improve the results. A removed trade accepts no lifecycle action, so nothing can alert
subscribers about a trade they cannot open, until it is put back.
