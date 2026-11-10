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

Only an `ACTIVATE` action moves a signal to `ACTIVE`. By the desk's rule, publishing applies it in the same transaction, so a
new signal is active at once; the activation is still its own event (internal, so subscribers get one alert), and it is never a
fill: no execution record is created. `activateOnPublish: false` keeps the older wait-for-entry flow. Terminal states
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
