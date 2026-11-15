# Testing

The native app's results are in [MOBILE_AUDIT.md](MOBILE_AUDIT.md), and how to run them in [MOBILE.md](MOBILE.md). The latest
results below are from 14 November 2026, after sign-up, enquiries, trials, password recovery and upcoming trades were
added, on one Apple Silicon Mac with 8 GB of memory, Node 22.23. Earlier rounds ran on 5, 6 and 8 November.

## Results

| Gate                                                            | Result                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| TypeScript, all packages (`strict`, `noUncheckedIndexedAccess`) | Pass                                                                                                       |
| ESLint, zero warnings allowed                                   | Pass                                                                                                       |
| Prettier                                                        | Pass                                                                                                       |
| Unit tests                                                      | **219 of 219**                                                                                             |
| Integration tests                                               | **287 of 287**                                                                                             |
| Native app unit and component tests (Jest)                      | **95 of 95**                                                                                               |
| Release bundles for Android and iOS (`expo export`)             | Pass                                                                                                       |
| Native app journeys, Android emulator in Expo Go                | **31 of 31** that can run here (see below). Screen protection was not run this round                       |
| End-to-end tests (website)                                      | **78 of 78**, on ports 3300 and 4300 beside a running demo                                                 |
| `npm audit --omit=dev`                                          | 3 moderate, all `minimatch` inside Expo's build tooling (`@expo/fingerprint`). Not introduced by this work |
| Secret scan                                                     | No secrets found                                                                                           |
| Tests skipped or weakened to pass                               | None                                                                                                       |

### 15 November: configuration, free days, website and app alike

| Gate                                       | Result                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Unit tests                                 | **226 of 226** (7 new: free days, the email account, saving settings)                                              |
| Integration tests                          | **291 of 291** (4 new: the email account, test email, sign-up switch, free days for a paying member)               |
| Native app unit and component tests (Jest) | **101 of 101** (6 new: sign-up paused or not yet open, About us, Configuration, free days)                         |
| Website end-to-end                         | **84 of 84** (6 new: landing page, Log In and Sign Up, sign-up not yet open, email tab, sign-up switch, free days) |
| Native app journeys, Android emulator      | **32 of 32** that can run here, including the new Configuration and free-days journey. Screen protection skipped   |
| iOS simulator build (CI, Xcode 26.6)       | Pass                                                                                                               |
| Types, lint, formatting, secret scan       | Pass                                                                                                               |

In the full phone run, 30 passed at once. Two failed:

- The new Configuration journey looked for tabs that sit past the edge of the scrolling tab row, and for a toast that
  had already gone. Both checks were fixed; it then passed.
- The first-sign-in journey once found the tour already on its second step. It passed when run again and did not
  happen again; the cause was not found.

The first website run found two accessibility contrast failures in the new pages (faded coloured text in light mode)
and three tests that assumed the old first page. All were fixed before the 84 of 84.

### 14 November: sign-up, trials, recovery and upcoming trades

**Phone.** All 32 journeys in `apps/mobile/e2e/run.mjs` ran on a separate Android emulator (6 GB, its own data) against a
throwaway stack. Five are new:

- sign-in errors;
- sign-up with email code, password and an emailed enquiry;
- a trial and its one-time welcome;
- an upcoming trade activated with levels and then corrected;
- password recovery reaching the administrators.

Emails were read from the file transport, never a real inbox.

In the final full run, 27 passed, screen protection was skipped and 4 failed. All 4 failures were the journeys
themselves:

- two needed to scroll to lines now below the fold;
- one tapped a field hidden behind the composer's sticky bar;
- one ran while an app file was being saved, which reloads the app.

After those fixes the 4 passed on the same stack. Sign-up, trial and recovery passed again after the last change to the
code screen. Screen protection needs Metro started without the capture switch; it is unchanged since it passed on
8 November.

Defects these runs found in the app, now fixed:

- the resend countdown lost its seconds on Android;
- granted a trial, the first-use tour covered the trial welcome;
- renewed while on the expired screen, coming back to the app did not check again for up to a minute;
- a short "OK" button was 43 points wide;
- the status screen said "Log out" where everything else says "Sign out";
- the phone's sign-up and recovery calls were refused for having no `Origin`.

Several older journeys and website tests had not been updated for the Master Admin round's changes:

- signals now start as Awaiting entry by default;
- hidden trades now have their own History filter.

They are updated now.

**Website.** The end-to-end suite ran in full on spare ports, with the website built against them, so it did not touch
the demo on 3000 and 4000:

```bash
API_ORIGIN=http://localhost:4300 NEXT_PUBLIC_WS_URL=ws://localhost:4300/ws npm run build -w @signaldesk/web
```

```bash
E2E_WEB_PORT=3300 E2E_API_PORT=4300 npm run test:e2e
```

Its first run found 8 failures:

- an accessibility rule: the "OK" button's spoken name did not include "OK";
- one administrator form label changed by mistake in a test;
- tests still expecting the old Signals heading.

All 78 passed after the fixes.

**Not run:** iOS (no Xcode here; CI bundles the iOS JavaScript on every pull request, and the native build runs from the "iOS build" workflow when started by hand), real email delivery (needs SMTP settings), and push to real phones.

### Native app journeys, 8 November

All 28 journeys in `apps/mobile/e2e/run.mjs` passed on an Android emulator through the throwaway stack, after fixes the
first runs found (below). New journeys: the first-use tour (and that it does not come back), hiding with Undo and restoring
from History while alerts continue, instrument and status filters, Alerts and News, one account per phone (refused, released
by an administrator, then allowed), the administrator's instruments, announcements and history screens, and screen protection.
The touch-target audit now requires 44 points at six screen sizes.

Screen protection ran with Metro started without the QA switch: a screenshot of a subscriber screen came back empty and the
window carried `FLAG_SECURE`, while an administrator screen captured normally. This is Android only; no iOS build ran.

Defects found by these runs and fixed: the tour did not appear for a second person signing in on the same phone without a
restart (it was remembered per app session, now per person); the tour could be replaced by the password screen's own
navigation; selectable announcement text was reported as a tiny control; the administrator's New signal button was 40
points tall.

## How to run

```bash
npm run test:unit
```

```bash
npm run test:integration
```

```bash
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium webkit
```

```bash
npm run build && PLAYWRIGHT_BROWSERS_PATH=0 npm run test:e2e
```

```bash
ulimit -n 20000 && SOCKETS=1000 EVENTS=100 DEVICES=500 npm run test:perf
```

Integration and end-to-end tests start their own PostgreSQL on a temporary directory, and need ports 4101 to 4106 free (integration) or 3000 and 4000 (E2E). The E2E ports can be moved with `E2E_WEB_PORT` and `E2E_API_PORT`; build the website against the same API port first, as shown above.

## Layers

### Unit: `packages/domain/test`

Pure logic with no I/O: BUY and SELL calculations, ranges, per-instrument point conversion, overrides, invalid prices, decimal precision, every state transition, stale versions, stop rules, partial exits with rounding, P&L aggregation, win-rate rules, expiry boundaries including daylight saving, renewal, access decisions, template rendering. One test replays a full trade's history and asserts it reproduces the stored state.

### Integration: `apps/api/test`

Black-box. Real API and worker **processes**, real PostgreSQL, real `ws` clients, and a local HTTPS push service. Nothing is mocked inside the application.

| File             | Tests | Highlights                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`           | 27    | No account enumeration, throttling, forced password change, session revocation, MFA including code replay and single-use recovery codes, malformed input                                                                                                                                                                                                                                       |
| `authorization`  | 14    | **Walks the live route table**, so a new route is covered automatically: anonymous gets 401 and subscribers get 403 on every admin route, expired gets 403 on every signal route. Position and money never reach subscribers                                                                                                                                                                   |
| `signals`        | 45    | The brief's worked example; twenty simultaneous identical submissions make one signal; concurrent administrators; full lifecycle; corrections; **direct SQL attempts to alter history are refused**; tampering is detected; timestamps are true instants                                                                                                                                       |
| `subscription`   | 18    | Expiry at the exact instant; renewal policies; sockets closing on expiry, suspension, revocation and sign-out                                                                                                                                                                                                                                                                                  |
| `realtime`       | 12    | Missed events exactly once and in order; concurrent publishers arrive in the same order at every client; bad messages                                                                                                                                                                                                                                                                          |
| `push`           | 20    | **Decrypts real Web Push payloads** using RFC 8291 and checks VAPID headers; hidden previews contain no prices; invalid devices removed; backoff; access re-checked at send time; **worker killed with SIGKILL**; two workers do not double-send                                                                                                                                               |
| `public`         | 10    | Public performance needs both keys; revocation closes it; no private data crosses                                                                                                                                                                                                                                                                                                              |
| `mobile`         | 36    | Native clients: bearer sign-in and access, no Origin needed but no cookie exemption, live stream with a token, device registration and ownership, push payloads and Android channels, hidden previews, receipts removing dead devices, retries, a worker crash with no double send, batching: each receipt matched to its own device, each device its own outcome, one bad token failing alone |
| `zz-reliability` | 6     | **PostgreSQL actually stopped and restarted**: safe errors, recovery, retry publishes once, sockets catch up; rate limiting: sessions on one address keep separate allowances, made-up credentials earn none, an ended session loses its allowance                                                                                                                                             |

### End-to-end: `e2e`

Production builds in real browsers.

| Project   | Browser                                                         | Tests |
| --------- | --------------------------------------------------------------- | ----- |
| `setup`   | Chromium: the administrator's real first sign-in, including MFA | 1     |
| `desktop` | Chromium, 1360×900                                              | 51    |
| `mobile`  | Chromium, Pixel 7 emulation                                     | 18    |
| `iphone`  | WebKit, iPhone 14 emulation                                     | 7     |

| Journey in the brief                                                                           | Where                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Admin: login → create user → subscription → BUY → publish → move stop → close → see the result | `admin.spec`, "complete administrator journey" |
| Subscriber: login → receive signal → open trade → receive update → history                     | `subscriber.spec`, on all three browsers       |
| Expiry: active → expired → revoked → renewed → restored                                        | `expiry.spec`                                  |
| Unauthorized: admin endpoints and paid content                                                 | `security.spec`, and `authorization.test`      |
| Reconnect: disconnect → events → reconnect → once, in order                                    | `reconnect.spec`                               |
| Duplicate submission: double-click and lost response                                           | `admin.spec`                                   |
| Financial integrity: insufficient data produces no money                                       | `admin.spec`                                   |

Also: keyboard-only publishing and trade actions, accessibility scans, sideways-scroll checks, content security policy, script injection through a comment, the service worker's handling of a real injected push message, notification permission flow, offline page.

### Accessibility

axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rule sets, on every public, subscriber and administrator screen plus the publish dialog, in **both themes, on desktop and mobile**. No violations. It found and we fixed: contrast on reached targets and shortcut hints, definition-list semantics, mismatched link names, an unfocusable scroll region.

Automated scans catch a limited share of accessibility issues. Keyboard paths are tested. **No person has used this with a screen reader.**

## Performance

**Setup:** one API process, one worker, PostgreSQL and the clients, all on one 8 GB laptop. There is no network, and the load generator competes for the same CPU. These show the software's behaviour, not a production capacity figure. 1,000 sockets, 100 events and 500 devices are the only sizes measured.

| Measure                                                                                    | p50     | p95         | p99      | Max      |
| ------------------------------------------------------------------------------------------ | ------- | ----------- | -------- | -------- |
| Publish a signal (request to response)                                                     | 38.3 ms | 41.5 ms     | 46.0 ms  | 77.8 ms  |
| **Live delivery: before the publish request until 1,000 clients read it** (50,000 samples) | 31.4 ms | **41.6 ms** | 119.1 ms | 139.8 ms |
| Feed load                                                                                  | 4.1 ms  | 5.2 ms      | 6.9 ms   | 27.7 ms  |
| Active trades                                                                              | 7.6 ms  | 8.9 ms      | 10.5 ms  | 11.3 ms  |
| Dashboard                                                                                  | 7.1 ms  | 8.6 ms      | 10.0 ms  | 61.0 ms  |
| Performance report (about 150 trades)                                                      | 6.0 ms  | 7.3 ms      | 7.6 ms   | 7.6 ms   |
| A request with a subscription check                                                        | 2.7 ms  | 3.1 ms      | 4.3 ms   | 5.9 ms   |
| Health check, no database (baseline)                                                       | 1.8 ms  | 2.1 ms      | 2.2 ms   | 3.3 ms   |

- **Target was p95 under 2,000 ms.** Met locally. Real delivery adds the network to the device, and that remains unmeasured.
- Every one of the 1,000 sockets received every one of the 100 events, in strict order.
- The subscription check costs about 1 ms over the baseline.
- 200 simultaneous feed requests finished in 263 ms in total.
- Push: 500 devices accepted in 0.65 s, about 774 per second, with real encryption and signing against a local endpoint with no network latency. A real push service will be slower.
- Native push: 1,200 devices handed to a local stand-in for Expo in **2.9 s using 12 requests**, down from 16.8 s and 1,200 requests before batching. The stand-in takes an assumed 200 ms per request. At an assumed 1,000 ms it took 12.5 s. Expo's real response time is unmeasured, and Apple and Google delivery comes after this.
- Rerun at 1,000 sockets and 30 events on the batching code: p95 42.0 ms, with every socket receiving every event in strict order.
- API memory with 1,000 sockets: 520 to 557 MB resident in the final run, and between 239 and 458 MB in an earlier one. Not profiled further.

## Not covered

| Gap                                                             | Why                                                                                            | What to do                                                                                                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Real push services and real phones                              | Headless browsers cannot subscribe to FCM, Apple or Mozilla, and native push needs credentials | On staging with HTTPS, test Android Chrome and an iPhone installed to the Home Screen, and the native app on both |
| Tapping a notification opens the trade                          | The handler and its open report have unit tests, not a real notification                       | Check by hand in the same session                                                                                 |
| Closed-app delivery on a real phone                             | Needs an Expo project, Firebase and an Apple account. Expo is replaced by a local stand-in     | Test every state in the notification matrix on a real Android phone and iPhone before launch                      |
| iPhone screen protection                                        | No iOS build or device here. Android's secure window is checked on the emulator                | Check screenshots, recording and the app switcher on a real iPhone                                                |
| Real iOS and Android devices                                    | Emulation only                                                                                 | As above                                                                                                          |
| Firefox                                                         | Browser not included                                                                           | Add to Playwright                                                                                                 |
| Docker, Compose, Caddy, CI workflow, backup and restore scripts | No Docker daemon or `pg_dump` here. Syntax checked only                                        | First staging deployment, and rehearse a restore                                                                  |
| Screen reader use                                               | Needs a person                                                                                 | VoiceOver and TalkBack pass                                                                                       |
| Load beyond 1,000 sockets, multiple API instances               | Not measured. Multiple workers are tested                                                      | Load test on staging hardware                                                                                     |
| Slow mobile networks                                            | Not simulated beyond disconnects                                                               | Throttled test on staging                                                                                         |
| Independent security testing                                    | Self-review only                                                                               | Commission a penetration test                                                                                     |

### 15 November, later: sign-up form back, one way in, login design (website only)

| Gate                                 | Result                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit tests                           | **226 of 226**                                                                                                                                                           |
| Integration tests                    | **291 of 291**                                                                                                                                                           |
| Website end-to-end                   | **85 of 85**. The sign-up tests were rewritten: one Create Account, the details form shown without email, the WhatsApp hand-off carrying the details, and the four steps |
| Types, lint, formatting, secret scan | Pass                                                                                                                                                                     |

The four-step sign-up test stubs the server's answers, because the test server sends no email; the server side of each
step is covered by the integration tests.

A later CI run failed two iPhone tests: the login ID typed by the test was lost. The cause was real: anything typed
or filled in by a password manager before the page's scripts have run was ignored, so Log In said "Enter your email
or username". Login and sign-up now take in what the fields already hold, and Log In reads the fields themselves.
Two tests hold the page's scripts back, type, then continue; the login one failed before the fix. Website end-to-end:
**87 of 87**.

Then the phone app got the same changes:

| Gate                                       | Result                                                                                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native app unit and component tests (Jest) | **103 of 103** (sign-up without email, the WhatsApp hand-off with the typed details, email first without a WhatsApp number, paused sign-up)                                                         |
| Native app journeys, Android emulator      | **9 of 10** chosen for the screens that changed: sign-in errors, disclosures, first sign-in (subscriber, admin), expiry, keyboard, sign-up with a real emailed code, trial welcome, forgot password |
| Types, lint, formatting, secret scan       | Pass                                                                                                                                                                                                |

The tenth, the large-text journey, needs an open signal left by journeys that were not in this run; it stopped on an
empty Signals list after signing in. The screens it checks were not changed.

### 15 November, fourth round: one performance view, hidden Master Admin functions, one access rule

| Gate                                       | Result                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                                 | **234 of 234** (new: the six-signal example from the brief, points kept per instrument, breakeven in the win rate, entitlement periods with a lapse, the automatic exit basis)                                                                                                                        |
| Integration tests                          | **298 of 298** (new: trades and announcements before and after joining, old identifiers, alerts and unread counts, the live stream, pushes, a renewal after a lapse, the ordinary administrator's refusals, dashboard and audit log, a closed trade in the results with no other step)                |
| Native app unit and component tests (Jest) | **103 of 103**                                                                                                                                                                                                                                                                                        |
| Website end-to-end                         | **88 of 88** (new: a range trade closed with and without a typed entry, an ordinary administrator with no Master Admin pages)                                                                                                                                                                         |
| Native app journeys, Android emulator      | **6 of 6** for the changed screens: first sign-in (subscriber and admin), a live signal to its result, publishing and closing with no basis question, the Performance screen, Configuration and free days. Two failed first on old wording in the journeys themselves and passed after it was updated |
| Types, lint, formatting, secret scan       | Pass                                                                                                                                                                                                                                                                                                  |

The rendered Performance page was checked at computer and phone width; the finished trades became a compact list on
phones after the first look showed a cramped table. iOS was not run.
