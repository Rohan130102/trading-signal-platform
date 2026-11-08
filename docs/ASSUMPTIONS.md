# Assumptions and decisions

Decisions made so the build could proceed. **The first group changes real numbers, so please check it.** All of these can be changed.

## Check these first

| #   | Decision                                                                                                                                                                                                                            | Why                                                                                                                                 | Change it in                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | **1 point = 1 USD on both XAU/USD and BTC/USD.**                                                                                                                                                                                    | The brief's worked example has entry 3300, target 3450 and stop 3120, so 150 points is 150 USD of price. It says nothing about BTC. | Instruments                                |
| 2   | **BTC/USD uses the same 150/180 point defaults, as the brief asks. This is probably far too tight.** At a BTC price near 100,000 a 180 USD stop is under 0.2%. The composer shows each distance as a percentage so this is visible. | Followed the brief rather than guessing.                                                                                            | Instruments                                |
| 3   | **Contract multiplier 1** on both, so 1 unit (1 oz, 1 BTC) moves 1 USD per 1 USD of price. If you record quantity in lots, set the multiplier (for example 100 oz per lot) or the monetary results will be wrong.                   | Brokers define lots differently.                                                                                                    | Instruments                                |
| 4   | **Business timezone Asia/Kolkata**, because the brief mentions an India-facing service. It decides when a subscription day begins and ends.                                                                                         | Stated convention.                                                                                                                  | Settings                                   |
| 5   | **"SignalDesk" is a placeholder name.** Check availability before using it commercially.                                                                                                                                            | The brief gave no name.                                                                                                             | Settings, `manifest.webmanifest`, metadata |

## Subscriptions

| Decision                 | Detail                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Inclusive calendar days  | N days from local date D runs through the end of D + N − 1. A 1-day subscription started at 14:00 ends at midnight tonight, not 14:00 tomorrow. |
| Renewal, still active    | New days are added after the current last day, so nothing already paid for is lost.                                                             |
| Renewal, already expired | A new period starts today.                                                                                                                      |
| History after expiry     | All private content is hidden. Nothing is retained for an expired subscriber, as the brief's default says.                                      |
| History while active     | Everything is visible, including signals from before the subscription began.                                                                    |
| Temporary password       | Valid 72 hours, must be replaced at first sign-in. For the first administrator, 24 hours.                                                       |

## Trading semantics

| Decision                                     | Detail                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Activation is manual                         | There is no market data feed, so nothing can tell the system an entry was hit. The administrator activates.                                                                                            |
| A trail is one instruction                   | "Trail" computes a new stop from a price you give. It does not keep moving by itself.                                                                                                                  |
| Partial exits                                | A percentage means a share of the **original** position, not of what remains.                                                                                                                          |
| Marking target 2 reached                     | Also marks target 1, since price passed it.                                                                                                                                                            |
| Maximum 3 targets                            | Matches the brief.                                                                                                                                                                                     |
| Default expiry                               | Signals have no entry deadline unless you set one, or set a default in Settings.                                                                                                                       |
| Reference for risk figures                   | For a range, the least favourable fill: upper bound for BUY, lower for SELL.                                                                                                                           |
| Priority                                     | Means time-critical, with louder alerts. It deliberately says nothing about likely outcome. There is no "high conviction" category.                                                                    |
| Moving a stop further away                   | Allowed, but needs a second explicit confirmation because it raises risk.                                                                                                                              |
| Closing a range signal with no recorded fill | Allowed, and recorded with no measurable outcome. No figure is invented.                                                                                                                               |
| Outcome labels for subscribers               | Feed and trade pages show the recorded move and its basis, never money or quantity. Whether even this needs changing is a compliance question. See [COMPLIANCE_CHECKLIST.md](COMPLIANCE_CHECKLIST.md). |

## Delivery

| Decision             | Detail                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Push lifetime        | One hour. A trading instruction arriving hours late could do harm.                                             |
| Push content         | Title and up to four lines, or just "New update" if the subscriber hides previews.                             |
| Live delivery target | p95 under 2 seconds from commit to the socket write in a healthy deployment, as suggested in the brief.        |
| Worker placement     | Separate process in production. It may run inside the API for a small single-node setup (`RUN_WORKER_IN_API`). |

## Sessions

| Setting               | Value                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscriber session    | 30 days, then sign in again. Push stops if the session ends.                                                                                                                                                    |
| Administrator session | 12 hours, or 2 hours idle.                                                                                                                                                                                      |
| Failed sign-ins       | 8 per login ID or 40 per IP in 15 minutes, then blocked for that window. No account state changes, so an attacker cannot lock someone out for longer than the window, or use lockouts to learn which IDs exist. |

## Mobile experience

| Decision                   | Detail                                                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deleting history           | Published trades are never deleted. Administrators archive finished ones, which leave the Signals list and stay in History with every event. Deleting losing trades would make the record misleading, and the event store is append-only. |
| Deleting announcements     | Sent ones can be archived or binned and restored; the event that was sent stays. Only never-sent drafts can be deleted permanently, with a typed confirmation.                                                                            |
| Hidden trades              | Hiding is a view choice for one subscriber. Alerts about a hidden trade still arrive, because a stop-loss change can matter whatever the list shows, and the trade stays in History.                                                      |
| Devices per account        | Not limited. Only one account per phone is enforced. A per-account limit was not in the requirements.                                                                                                                                     |
| Audience targeting         | Everyone with access. There is one subscription tier, so tier or group targeting has nothing to act on yet.                                                                                                                               |
| Announcement images        | Not supported. There is no file storage, and text with an optional link covers the use.                                                                                                                                                   |
| Direction colours          | Blue for buy and pink for sell, from the existing design system, always with the word. Green and red stay reserved for targets reached and stop-losses, so direction never reads as profit or loss.                                       |
| iPhone interruption levels | Time-sensitive only for a new signal, a stop-loss move, a close, a cancellation, an urgent instruction or a priority message. Routine updates and announcements are active; learning notes are passive. Critical alerts are never used.   |

## Scope

Deliberately not built, as the brief excludes or defers them: payment collection, order placement, broker connection,
copy trading, native apps, SMS or email, multi-level administrator permissions, Redis.

Dark theme is the default. The product is English only. Public pages are marked `noindex` until compliance review is done.
