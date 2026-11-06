# Final audit

Audit date: 5 November 2026. Full evidence: [TESTING.md](TESTING.md).

## Readiness

| Stage                                       | Assessment                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local development                           | **Ready.** `npm run dev` was run from the documented steps.                                                                                        |
| Staging                                     | **Ready to attempt.** The application is well tested, but its container and proxy files have never run, so expect small fixes on first deployment. |
| Controlled production with real subscribers | **Not ready.** See the gates below.                                                                                                                |
| Public launch                               | **Not ready.**                                                                                                                                     |

### Unmet release gates

| Gate                                                                                                                                                         | Owner              | Blocking?             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------- |
| Legal review: registration, whether these instruments may be offered, advertising, client agreements. See [COMPLIANCE_CHECKLIST.md](COMPLIANCE_CHECKLIST.md) | You, with a lawyer | **Yes, hard blocker** |
| Deploy to staging and fix anything the unexercised files reveal                                                                                              | Engineering        | Yes                   |
| Real-device push on Android Chrome and an installed iPhone app                                                                                               | Engineering        | Yes                   |
| Rehearse backup and restore                                                                                                                                  | Engineering        | Yes                   |
| Confirm instrument assumptions, BTC/USD point values above all. See [ASSUMPTIONS.md](ASSUMPTIONS.md)                                                         | You                | Yes                   |
| Replace placeholder legal text with reviewed text                                                                                                            | You, with a lawyer | Yes                   |
| Independent penetration test                                                                                                                                 | You                | Strongly recommended  |
| Screen-reader pass with a real person                                                                                                                        | You                | Recommended           |

## Status by capability

| Status                                       | Items                                                                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Implemented and tested**                   | Sign-in and MFA; subscribers and expiry; instruments; composer; templates; trade lifecycle; corrections; P&L; performance dashboard; live feed and recovery; Web Push sending; service worker handling; audit log; hash chain; public gate |
| **Implemented, externally unverified**       | Delivery through real push services to real phones; tapping a notification; real iOS install; Docker, Compose, Caddy, CI; backup and restore scripts                                                                                       |
| **Blocked by credentials or infrastructure** | Real push needs HTTPS hosting. Container testing needs a Docker daemon                                                                                                                                                                     |
| **Blocked by regulatory approval**           | Commercial operation; the public results section                                                                                                                                                                                           |
| **Explicitly out of scope**                  | Order execution, brokers, copy trading, payments, native apps, SMS and email, tiered admin roles                                                                                                                                           |

## Defects found and fixed

Each was fixed and retested, with a regression test unless noted. **None of the Critical or High items remain open.**

### Critical

| #   | Finding                                                                                                                                                                                                                                                                      | How it was found                                                               | Fix                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| C1  | **Every stored timestamp was wrong on a non-UTC server, off by 5h30 on this IST machine.** The driver sends times without an offset, and reads shifted them back, so a round trip looked fine. Expiry comparisons in SQL, and retry and deadline scheduling, were all wrong. | Integration tests failing in a way that only made sense once measured directly | UTC forced per connection and per database. Test compares against the database clock |

### High

| #   | Finding                                                                                                                                                    | Fix                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| H1  | The public home page crashed in the browser: a server component called a client-only function                                                              | Moved to a shared module. Covered by E2E                                            |
| H2  | **The whole app was dead in WebKit over plain HTTP.** `upgrade-insecure-requests` blocked every script, so sign-in did nothing                             | Header now follows the actual scheme. WebKit project added                          |
| H3  | A parallel copy of a publish or update could get a false "duplicate" or "stale" error instead of the original result                                       | Key re-checked under the row lock                                                   |
| H4  | A parallel copy of "create subscriber" could get "login ID taken"                                                                                          | The idempotency key is checked first                                                |
| H5  | **A client reconnecting during a database outage could crash the API**, through an unhandled rejection                                                     | Failures contained and retried on the next tail. Test stops PostgreSQL mid-catch-up |
| H6  | The sweeper took a session-level lock through a connection pool, so signal expiry could silently stop with more than one worker                            | Lock removed: the work is safe to run concurrently                                  |
| H7  | The gated public results payload included monetary totals, which would have revealed private position sizes                                                | Removed. Tested                                                                     |
| H8  | Net P&L was added up across different quote currencies                                                                                                     | Hidden when mixed, with an explanation. Tested                                      |
| H9  | A background refresh remounted an open action dialog, losing typed text and silently applying the action to a newer version the administrator had not seen | Version pinned when the dialog opens, so a stale screen is refused. Tested          |

### Medium

| #   | Finding                                                                                               | Fix                                                         |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| M1  | "You are offline" stuck on screen if the socket survived the outage                                   | Connection logic rewritten as a small class                 |
| M2  | Feed cards showed "+150 pts" with no statement of what it rests on, implying a real result            | Basis now shown beside every figure                         |
| M3  | Repeating fractions could leave a residual, and computed values could differ from stored ones         | Rounded to storage scale at calculation time                |
| M4  | Extreme inputs caused a database overflow and a 500                                                   | Clear validation error                                      |
| M5  | Impossible dates such as 2026-02-30 caused a 500                                                      | Validated at the boundary                                   |
| M6  | Malformed JSON returned parser internals to the client                                                | Fixed wording, no internals                                 |
| M7  | Dialogs animated in from the wrong place (the keyframe doubled the centring offset)                   | Found by inspecting a screenshot. No automated test: visual |
| M8  | Refreshing the composer lost the link to its draft, leaving an orphan after publishing                | Draft reference preserved. Tested                           |
| M9  | On a phone, trade actions were below the entire timeline                                              | Moved first, in two columns                                 |
| M10 | Landing copy promised delivery "the moment they happen", contradicting the disclosures                | Reworded                                                    |
| M11 | Announcements had an API but no screen                                                                | Added, with a test                                          |
| M12 | One failing push row could strand its whole batch until claims expired                                | Isolated per row                                            |
| M13 | A bad entry price showed three errors, two of them derived                                            | Only the cause is shown                                     |
| M14 | Five accessibility problems, listed in [TESTING.md](TESTING.md)                                       | Fixed                                                       |
| M15 | No general request limit                                                                              | Added per IP, per instance                                  |
| M16 | No recovery if an administrator lost both password and recovery codes                                 | `npm run admin:reset`                                       |
| M17 | A feed left open kept saying "just now" about old signals, and showed no actual time on touch screens | Live clock, with the time always visible. Tested            |
| M18 | Unread count ignored what was missed while away, and could stay stale after a background tab          | Now uses the server's count. Tested                         |

## The five reviews

### 1. Senior developer

| Question                                    | Answer                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Understandable, responsibilities separated? | Yes. Pure domain package, thin controllers, one write path for events                             |
| Financial logic central?                    | Yes. Only in `packages/domain`. The composer's preview runs the same code as the server           |
| Types accurate?                             | `strict`, with `noUncheckedIndexedAccess` and no `any` in application code                        |
| Race conditions?                            | H3 to H6, H9 were real and are fixed. Remaining paths use row locks, unique keys or `SKIP LOCKED` |
| Failures handled?                           | One consistent error shape; background failures contained (H5, M12)                               |
| Unnecessary dependencies?                   | Evaluated individually. Redis deliberately omitted                                                |

**Remaining (Low):** the composer page is large at about 1,000 lines; it would benefit from being split. `disable` is API-only, since the UI offers suspend.

### 2. Principal architect

| Question                                  | Answer                                                                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meets the business need?                  | Yes, as a modular monolith without distributed complexity                                                                                                                                 |
| State changes atomic?                     | Event, projection, outbox and audit commit together. Tested by failing an action and checking nothing remains                                                                             |
| Can notifications be lost or duplicated?  | Loss: no, outbox and polling backstops, tested by killing the worker. Duplicates: at-least-once, collapsed by unique rows and notification tags. **Exactly-once delivery is not claimed** |
| Access revocation correct?                | One rule in three places, and tested at each                                                                                                                                              |
| Moderate scale without redesign?          | API and worker scale out by design. Multiple workers are tested. **Multiple API instances are not**                                                                                       |
| Infrastructure unnecessarily complicated? | No: PostgreSQL is the only stateful service                                                                                                                                               |
| Backup and restore defined?               | Yes, with encryption, but **not yet rehearsed**                                                                                                                                           |

**Remaining (Medium):** multi-instance API not tested. MFA key rotation has no procedure. The public results page has had only its API gate tested, not a browser pass with the gate open.

### 3. QA lead

| Question                             | Answer                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Malformed input?                     | Rejected cleanly (M4 to M6)                                            |
| Simultaneous actions?                | Tested: one wins, the other is told to refresh                         |
| Duplicate trades?                    | Double-click, lost response and 20 parallel copies all give one signal |
| Invalid P&L?                         | Null by construction when data is missing. Bases cannot mix            |
| Historical data modifiable?          | Direct SQL is refused. Tampering with triggers disabled is detected    |
| Users going offline?                 | Tested. Banner shows, and recovery is exact                            |
| Expired subscriber reading messages? | Refused on REST, socket and push, including a push already queued      |
| Critical journeys tested?            | All seven in the brief                                                 |

**Remaining (Medium):** the gaps in [TESTING.md](TESTING.md), real devices above all.

### 4. UI/UX expert

Reviewed through screenshots of every screen on desktop and phone, in dark, and several in light.

| Question                        | Answer                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Premium and cohesive?           | Consistent tokens and components; restrained colour                                                                                                                                |
| Can admins publish quickly?     | **Keyboard: 5 inputs** (`1`, `S`, price, `Enter`, `Enter`). **Touch: 4** when the instrument is already selected. Move a stop: 3                                                   |
| Design minimizes errors?        | Levels previewed; bad prices block review; widening a stop needs a second confirmation; duplicates warned                                                                          |
| Active trades easy to identify? | Separate tab, with current levels                                                                                                                                                  |
| Mobile?                         | No sideways scroll on any screen measured. Buttons and navigation are at least 44 px on touch layouts. Inline text links are smaller and pass the 24 px rule in WCAG 2.2. M9 fixed |
| Warnings useful?                | Each says what happened and what to do                                                                                                                                             |

**Remaining (Low):** the admin dashboard gets long on a phone with many live trades. With no real product name or logo yet, the brand is deliberately plain.

### 5. First-time user

| Task                       | Outcome                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| Log in                     | One screen, with a plain error. Forced password change explains why                                |
| Understand the main screen | Each card says "New signal", "Update to T-0042" or "Closed"                                        |
| Find a trade               | Active tab; cards link to the trade                                                                |
| BUY versus SELL            | Word, arrow and colour                                                                             |
| Targets and stop-loss      | Same layout everywhere, labelled                                                                   |
| Understand a moved stop    | Old price struck through, arrow, new price; "was" on the trade                                     |
| Find a previous signal     | History with search                                                                                |
| Subscription expiry        | Account says "Active through…, N days left". Expired screen says what happened and whom to contact |
| Enable notifications       | Prompt on the feed, with iPhone-specific steps and advice when blocked                             |
| Know a trade closed        | Plain sentence: "This trade is finished. No further action is needed."                             |

This walk-through was done by the builder imagining a new user, which is weaker than watching one. **Put it in front of two or three real people.**

**Remaining (Low):** "Awaiting entry" and "breakeven" assume some trading vocabulary, which seems fair for this audience.

## Known limitations

| Severity | Item                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | No subscriber data export or erasure tool. Manual for now. See the compliance checklist                                                                                      |
| Medium   | No client-agreement acceptance flow, which counsel may require                                                                                                               |
| Medium   | No error-tracking integration. Logs only                                                                                                                                     |
| Low      | The per-IP limit is per instance. Sign-in throttling is shared                                                                                                               |
| Low      | Trade reference numbers can skip a value after a failed publish                                                                                                              |
| Low      | Dev tooling has 10 moderate advisories. Not shipped                                                                                                                          |
| Low      | Prices are not checked against any market, since no data feed exists. A typo that passes validation is caught only by the preview, and by the correction workflow afterwards |

## Assessment

The core product is complete, and its behaviour is verified: correct calculations, access control, event integrity, reliable delivery within what could be tested. The most serious defects were found by tests and by inspection, not assumed away.

It should not take real subscribers yet. **The largest risk is no longer technical: it is whether this service may legally operate as designed.** Resolve that first, because the answer could change which instruments can be offered, and to whom.
