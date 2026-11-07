# Testing

The native app's results are in [MOBILE_AUDIT.md](MOBILE_AUDIT.md), and how to run them in [MOBILE.md](MOBILE.md). The tables below were
executed on 5 November 2026 on the web platform. The unit, integration and web end-to-end suites were run again on 6 November after
the mobile work, on one Apple Silicon Mac with 8 GB of memory, Node 22.23.

## Results

| Gate                                                            | Result                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| Clean install from lockfile (`npm ci`) and build                | Pass                                                   |
| TypeScript, all packages (`strict`, `noUncheckedIndexedAccess`) | Pass                                                   |
| ESLint, zero warnings allowed                                   | Pass                                                   |
| Prettier                                                        | Pass                                                   |
| Unit tests                                                      | **154 of 154**                                         |
| Integration tests                                               | **186 of 186**                                         |
| End-to-end tests                                                | **77 of 77**                                           |
| `npm audit --omit=dev`                                          | **0 vulnerabilities**                                  |
| `npm audit` including dev tooling                               | 10 moderate, all `minimatch` through ESLint. None ship |
| Tests skipped or weakened to pass                               | None                                                   |

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

Integration and end-to-end tests start their own PostgreSQL on a temporary directory, and need ports 3000 and 4000 free (E2E) or 4101 to 4106 free (integration).

## Layers

### Unit: `packages/domain/test`

Pure logic with no I/O: BUY and SELL calculations, ranges, per-instrument point conversion, overrides, invalid prices, decimal precision, every state transition, stale versions, stop rules, partial exits with rounding, P&L aggregation, win-rate rules, expiry boundaries including daylight saving, renewal, access decisions, template rendering. One test replays a full trade's history and asserts it reproduces the stored state.

### Integration: `apps/api/test`

Black-box. Real API and worker **processes**, real PostgreSQL, real `ws` clients, and a local HTTPS push service. Nothing is mocked inside the application.

| File             | Tests | Highlights                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`           | 27    | No account enumeration, throttling, forced password change, session revocation, MFA including code replay and single-use recovery codes, malformed input                                                                                                                                                                                                                                       |
| `authorization`  | 14    | **Walks the live route table**, so a new route is covered automatically: anonymous gets 401 and subscribers get 403 on every admin route, expired gets 403 on every signal route. Position and money never reach subscribers                                                                                                                                                                   |
| `signals`        | 43    | The brief's worked example; twenty simultaneous identical submissions make one signal; concurrent administrators; full lifecycle; corrections; **direct SQL attempts to alter history are refused**; tampering is detected; timestamps are true instants                                                                                                                                       |
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
| Tapping a notification opens the trade                          | The handler exists, with no automated test                                                     | Check by hand in the same session                                                                                 |
| Real iOS and Android devices                                    | Emulation only                                                                                 | As above                                                                                                          |
| Firefox                                                         | Browser not included                                                                           | Add to Playwright                                                                                                 |
| Docker, Compose, Caddy, CI workflow, backup and restore scripts | No Docker daemon or `pg_dump` here. Syntax checked only                                        | First staging deployment, and rehearse a restore                                                                  |
| Screen reader use                                               | Needs a person                                                                                 | VoiceOver and TalkBack pass                                                                                       |
| Load beyond 1,000 sockets, multiple API instances               | Not measured. Multiple workers are tested                                                      | Load test on staging hardware                                                                                     |
| Slow mobile networks                                            | Not simulated beyond disconnects                                                               | Throttled test on staging                                                                                         |
| Independent security testing                                    | Self-review only                                                                               | Commission a penetration test                                                                                     |
