# Requirements matrix

Every item in the brief's acceptance criteria and major sections, how it is implemented and how it was verified.

**Status:** ✅ implemented and tested · 🟡 implemented, partly or externally unverified · ⛔ blocked on something outside the code · ➖ deliberately not built

**Test locations:** `D` = `packages/domain/test`, `I` = `apps/api/test`, `E` = `e2e`.

## Acceptance criteria (brief, section 27)

| #   | Requirement                                  | Implementation                                                | Verified by                                                                             |     |
| --- | -------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --- |
| 1   | Administrator can securely log in            | Argon2id, opaque session cookie, mandatory TOTP               | `I/auth`, `E/admin-onboarding`, `E/admin`                                               | ✅  |
| 2   | Administrator can create subscriber accounts | `SubscribersService.create`, Subscribers page                 | `I/subscription`, `E/admin`                                                             | ✅  |
| 3   | Secure credential onboarding                 | Temporary password shown once, 72-hour life, forced change    | `I/auth`, `E/subscriber`                                                                | ✅  |
| 4   | Subscription duration configurable           | Days and start date on creation; renew; adjust                | `D/subscription`, `I/subscription`                                                      | ✅  |
| 5   | Expiry enforced on the backend               | `evaluateSignalAccess` on every request, socket and push      | `I/authorization`, `I/subscription`, `E/expiry`                                         | ✅  |
| 6   | Renewals restore access                      | `computeRenewal`                                              | `D/subscription`, `I/subscription`, `E/expiry`                                          | ✅  |
| 7   | Administrator can configure instruments      | Instruments page, no code change                              | `I/signals`, `E/admin`                                                                  | ✅  |
| 8   | BTC/USD and XAU/USD available                | Seed                                                          | `E/admin`, `I/signals`                                                                  | ✅  |
| 9   | BUY and SELL signals                         | Composer                                                      | `D/signal`, `I/signals`, `E/admin`                                                      | ✅  |
| 10  | Single-price and range entries               | `EntryLevels`                                                 | `D/signal`, `I/signals`, `E/admin`                                                      | ✅  |
| 11  | Targets directionally correct                | `calculateLevels`, `validateSignalLevels`                     | `D/signal`, `E/admin`                                                                   | ✅  |
| 12  | Stop-loss directionally correct              | Same                                                          | `D/signal`, `E/admin`                                                                   | ✅  |
| 13  | Precision and point definitions respected    | `InstrumentSpec`, snapshot at publication                     | `D/signal`, `I/signals`, `E/admin`                                                      | ✅  |
| 14  | Templates available                          | 17 kinds, editable                                            | `D/subscription`, `I/signals`                                                           | ✅  |
| 15  | Previews correct                             | Same domain code as the server; review dialog                 | `E/admin`                                                                               | ✅  |
| 16  | Published signals persist reliably           | Single transaction with outbox                                | `I/signals`, `I/zz-reliability`                                                         | ✅  |
| 17  | Duplicate publishing prevented               | Idempotency key, duplicate warning                            | `I/signals`, `E/admin`                                                                  | ✅  |
| 18  | Connected subscribers get live updates       | `RealtimeGateway`                                             | `I/realtime`, `E/subscriber`, `scripts/perf.mjs`                                        | ✅  |
| 19  | Opted-in devices can receive push attempts   | `WorkerService`, `web-push`, service worker                   | `I/push`, `E/notifications`. **Not tried on real phones or through real push services** | 🟡  |
| 20  | Subscriber history preserved                 | Append-only events                                            | `I/signals`, `E/subscriber`                                                             | ✅  |
| 21  | Missed events recovered on reconnect         | Cursor-driven replay                                          | `I/realtime`, `E/reconnect`                                                             | ✅  |
| 22  | Administrator can update active trades       | 13 lifecycle actions                                          | `D/lifecycle`, `I/signals`, `E/admin`                                                   | ✅  |
| 23  | Stop-loss changes retain history             | `originalStopLoss`, event log                                 | `D/lifecycle`, `I/signals`, `E/subscriber`                                              | ✅  |
| 24  | Partial closure correct                      | Closures with fraction and quantity                           | `D/lifecycle`, `D/pnl`, `I/signals`, `E/admin`                                          | ✅  |
| 25  | Full closure works                           | `CLOSE` action                                                | Same                                                                                    | ✅  |
| 26  | P&L follows a documented basis               | `computeClosureResult`, methodology `pnl-v1`, shown in the UI | `D/pnl`, `I/signals`                                                                    | ✅  |
| 27  | No monetary result from incomplete data      | Null by construction                                          | `D/pnl`, `I/signals`, `E/admin`                                                         | ✅  |
| 28  | Internal performance dashboard               | Performance page                                              | `I/signals`, `E/admin`                                                                  | ✅  |
| 29  | Public claims gated by compliance            | Two independent keys                                          | `I/public`, `E/admin`                                                                   | ✅  |
| 30  | Public users cannot reach signals            | Default-deny guard                                            | `I/authorization`, `E/security`                                                         | ✅  |
| 31  | Expired users cannot reach signals           | Same                                                          | `I/authorization`, `E/expiry`                                                           | ✅  |
| 32  | Critical administrative changes audited      | Append-only `audit_logs`, viewer                              | `I/auth`, `I/signals`, `E/admin`                                                        | ✅  |
| 33  | Works on mobile and desktop                  | Responsive, PWA                                               | `E/responsive` on desktop and Pixel 7; `E/subscriber` also on iPhone emulation          | ✅  |
| 34  | Primary workflows have automated tests       | See [TESTING.md](TESTING.md)                                  |                                                                                         | ✅  |
| 35  | Production configuration documented          | [DEPLOYMENT.md](DEPLOYMENT.md), `.env.example`                | Container files not exercised                                                           | 🟡  |
| 36  | Critical security findings resolved          | [FINAL_AUDIT.md](FINAL_AUDIT.md)                              | No independent penetration test                                                         | 🟡  |

## Other sections of the brief

| Section | Requirement                                                                     | Status | Notes                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6       | Dashboard with one dominant action, trades, subscribers, health, alerts         | ✅     |                                                                                                                                                                     |
| 7       | Composer: keyboard, defaults, recent instruments, drafts, quick and advanced    | ✅     | Keyboard path tested end to end                                                                                                                                     |
| 7       | Risk summary with no implied payoff                                             | ✅     | States that it is geometry only                                                                                                                                     |
| 8       | Templates with structured fields, editable, exact text persisted                | ✅     |                                                                                                                                                                     |
| 8       | Colour is never the only signal                                                 | ✅     | Arrow and text on direction; label on events; axe scans                                                                                                             |
| 9       | State machine, no assumed fills                                                 | ✅     |                                                                                                                                                                     |
| 9       | Trade detail with chronological timeline                                        | ✅     |                                                                                                                                                                     |
| 10      | Dedicated update actions and auditable corrections                              | ✅     |                                                                                                                                                                     |
| 10      | Event integrity, server timestamps, ordering, stale-update protection           | ✅     | Enforced in the database                                                                                                                                            |
| 11      | Closure workflow, partial exits capped at the position                          | ✅     |                                                                                                                                                                     |
| 12      | P&L engine, decimal-safe, bases distinguished                                   | ✅     | Externally verified basis is reserved and unreachable                                                                                                               |
| 13      | Public performance module behind a compliance gate                              | ✅     | Built, and off                                                                                                                                                      |
| 14      | Secure subscriber login, throttling, enumeration protection                     | ✅     |                                                                                                                                                                     |
| 14      | Lockout and recovery                                                            | ✅     | Windowed throttling, admin reset, break-glass CLI                                                                                                                   |
| 15      | Feed, active, history, account, all empty and error states                      | ✅     |                                                                                                                                                                     |
| 16      | Delivery flow, retries, idempotency, dead letter, invalid token removal         | ✅     | Live delivery tails the log rather than passing through the worker: see [ARCHITECTURE.md](ARCHITECTURE.md)                                                          |
| 16      | PWA install and iOS Add to Home Screen guidance                                 | 🟡     | Guidance tested in emulation; real iOS install not tried                                                                                                            |
| 16      | Measured delivery SLO                                                           | ✅     | Local measurements only: see [TESTING.md](TESTING.md)                                                                                                               |
| 17      | Subscriber administration                                                       | ✅     | `disable` is API-only; the UI offers suspend                                                                                                                        |
| 18      | Expiry semantics, UTC internally, renewal policy, no duplicates                 | ✅     |                                                                                                                                                                     |
| 19      | Dark and light themes, design system, motion restraint                          | ✅     |                                                                                                                                                                     |
| 19      | WCAG 2.2 AA                                                                     | 🟡     | Automated axe scans pass on all scanned screens in both themes; keyboard paths tested. **No screen-reader session with a person**                                   |
| 20      | Data model, constraints, indexes, migrations                                    | ✅     |                                                                                                                                                                     |
| 21      | Security controls and threat model                                              | ✅     |                                                                                                                                                                     |
| 22      | Regulatory review                                                               | ⛔     | [COMPLIANCE_CHECKLIST.md](COMPLIANCE_CHECKLIST.md). Needs a lawyer                                                                                                  |
| 23      | Unit, integration, E2E, reliability, performance, security, accessibility tests | ✅     |                                                                                                                                                                     |
| 24      | Five-perspective review                                                         | ✅     | [FINAL_AUDIT.md](FINAL_AUDIT.md)                                                                                                                                    |
| 25      | Enhancements                                                                    | ✅     | Favourites, shortcuts, reuse, duplicate warnings, expiry alerts, unread count, filters, preferences, diagnostics, theme, retry, audit viewer, feature flags, health |
| 25      | Scheduled announcements                                                         | ➖     | Optional. Not built                                                                                                                                                 |
| 30      | All listed documents                                                            | ✅     |                                                                                                                                                                     |

## Deliberately out of scope

Order execution, broker integration, copy trading, payment collection, native apps, SMS or email, multi-level admin permissions, additional languages.
