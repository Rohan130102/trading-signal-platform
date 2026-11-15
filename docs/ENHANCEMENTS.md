# Onboarding, subscriptions, trials and signal refresh

What changed in this round, why, and where each requirement lives. Built on top of the existing
architecture: nothing was rebuilt, and accounts, subscriptions, trades and their history are kept.

## What already existed and was reused

| Need                           | Existing piece reused                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed-in users without access | `evaluateSignalAccess` (one rule for REST, WebSocket and push). Expired users could already sign in.                                                                          |
| Custom subscription length     | `durationDays` (1–3660) on create and renew, inclusive calendar days in the business timezone.                                                                                |
| Renewal semantics              | `computeRenewal`: running subscriptions extend from expiry. Now also takes an activation date for expired ones.                                                               |
| Temporary passwords            | `newTemporaryPassword`, `mustChangePassword`, `tempPasswordExpiresAt`, forced change on next sign-in.                                                                         |
| Pending trades                 | `PUBLISHED` ("Awaiting entry") and the separate `ACTIVATE` action. No new lifecycle state was added.                                                                          |
| Audit trail                    | Append-only `audit_logs`, `signal_events`, `subscription_events`.                                                                                                             |
| Push, live updates             | The outbox worker, `push_deliveries`, Expo and Web Push transports, `pg_notify` channels.                                                                                     |
| History                        | Trades leave the live lists and appear in History as soon as they close. No approval step existed; a test now guards it. The public-performance compliance gate is unchanged. |

## Checklist

| #            | Requirement                                                                     | Where                                                                         | Tests                                               |
| ------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| 2            | Log In / Sign Up screen, email or username, show/hide password                  | web `login`, `signup`; mobile `(auth)/login`, `(auth)/signup`                 | e2e `onboarding.spec`, mobile `configuration.test`  |
| 3.1          | Five required fields, phone in E.164 (default +91), age with legal minimum      | domain `registration.ts`; API `registration.service`                          | domain `registration.test`; API `registration.test` |
| 3.2          | Email code: 6 digits, 5 minutes, 5 tries, 60 s resend, hashed, rate limited     | API `email-challenge.service`                                                 | API `registration.test`                             |
| 3.3          | Create password after verification, account enabled, no access                  | API `registration.service.complete`                                           | API `registration.test`                             |
| 4            | WhatsApp enquiry with email fallback, never claimed as sent                     | domain `support.ts`; API `enquiries.service`; web/mobile `SubscriptionStatus` | domain `support.test`; API `enquiries.test`         |
| 4.4          | Support WhatsApp and email set by the Master Admin only, audited                | API `settings`; web/mobile settings                                           | API `enquiries.test`                                |
| 5            | Identity, enquiry and access kept separate                                      | `users.email_verified_at`, `users.enquiry_status`, `subscriptions.kind`       | API `registration.test`, `trials.test`              |
| 6            | New Registrations list with badge, filters, detail actions                      | API `registrations` in `subscribers`; web/mobile admin                        | API `registration.test`                             |
| 7            | Start / renew with any number of days, preview, no shortening                   | domain `subscription.ts`; API `subscribers.service`                           | domain `subscription.test`; API `trials.test`       |
| 7.4, 8.4, 18 | Email + in-app + push for start, renewal and trial                              | API `notices.service`, `email` outbox, worker                                 | API `trials.test`                                   |
| 8            | Admin-granted free days for any member, never automatic, one greeting per grant | `trial_grants`; API `trials` in `subscribers.service`; `TrialGreeting`        | API `trials.test`                                   |
| 9            | Expired users sign in, see renewal screen, get no new private data              | existing access rule; `SubscriptionStatus` screens                            | API `trials.test` (expiry and restore)              |
| 10           | Forgot password: email code, then admin-issued temporary password               | API `password-reset.service`; web/mobile admin list                           | API `password-reset.test`                           |
| 11           | Range trade published with no target or stop, activated later with levels       | domain `lifecycle.ts`, `contracts.ts`; composer; Activate form                | domain `lifecycle.test`; API `signals.test`         |
| 12           | Clean correction wording for subscribers, full audit kept                       | domain `templates.ts`, `lifecycle.ts`                                         | domain `lifecycle.test`                             |
| 13, 16       | Minimal copy, "Edit Levels Manually", consistent action names                   | domain `copy.ts`; all screens                                                 | domain `copy.test`                                  |
| 14           | Signals page: Upcoming, Active, History                                         | web `app/page.tsx`; mobile `feed.tsx`                                         | e2e, mobile tests                                   |
| 15           | Closed trades in History at once                                                | existing queries                                                              | API `signals.test`                                  |
| 17           | One reversible, additive migration                                              | `20261114000000_onboarding_trials`                                            | migrate from the previous schema                    |

## Decisions

- **Sign-in identifier.** A self-registered account's login ID is its email address, so either works. Older
  accounts keep their login ID; their email also signs them in when exactly one account has it.
- **Minimum age 18.** Not a business choice: the Digital Personal Data Protection Act 2023 (s. 2(f), s. 9) treats
  anyone under 18 as a child whose data needs verifiable parental consent, and the Indian Contract Act 1872 (s. 11)
  does not let a minor contract for a paid service. The limit lives in one constant, `MIN_REGISTRATION_AGE`.
- **Enumeration.** Sign-up and password recovery answer the same way whether or not an account exists. An address
  that already has an account gets an email saying so instead of a code.
- **Email.** One adapter (`EMAIL_TRANSPORT`): `smtp` for real delivery, `file` for development and tests (refused
  in production), `disabled`. Codes are sent at once and never stored readable; everything else goes through a
  durable `email_outbox` with retries. "Sent" means the provider accepted it, not that it arrived.
- **WhatsApp.** The web opens `https://wa.me/<digits>?text=…` and never records a message as sent. The phone app
  opens `whatsapp://send`; only if the system reports WhatsApp missing does it send the enquiry by email, after the
  user's tap. Enquiry records say what actually happened: link opened, email accepted, or email failed.
- **Trials.** Any administrator can give any member free days, at any time and as often as needed. While access is
  running, paid or trial, the days are added after its last day and a paying member stays paid; otherwise a trial
  starts on the chosen date. Every grant is kept in `trial_grants` for reporting and the one-time welcome.
- **Payment confirmed.** The product does not track offline payment, so the "Activation pending" state is not shown.
- **Upcoming trades.** A range signal may be published without a target or stop-loss. It stays "Awaiting entry";
  activating it requires the final entry, at least one target and a stop-loss, and updates the same trade. The
  original range stays in its timeline. Single-price signals and range signals with levels are unchanged.
- **Corrections.** Subscribers see "Stop-loss updated: 64,920 (was 64,800)" and no reason or name. The reason, the
  administrator and every earlier value stay in the event payload and audit log, visible to administrators.
- **"Hypothetical".** Cards say "Signal result" for points measured from the signal's own entry and "Recorded entry"
  for an administrator-declared fill, and the administrator picks the same words when recording an exit. The
  methodology note on History still says these are not anyone's profits. The public performance record and the
  administrators' analytics keep "Hypothetical": there it is the disclosure, and it stays.

## Review: what each perspective found, and what was fixed

| Perspective      | Finding                                                                                                                           | Fix                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Senior developer | Renewing someone with no subscription said "Subscriber not found"                                                                 | Now `409 NO_SUBSCRIPTION`: start one instead                                                         |
| Senior developer | A corrected sign-up field kept its old error until the next submit                                                                | Editing a field clears its message, on web and phone                                                 |
| Architect        | The phone app's sign-up and recovery calls carry no `Origin`, and would have been refused                                         | Exactly those cookie-free steps are exempt; the web's cookie-setting step is not. Tested both ways   |
| Architect        | The resend countdown read the server's timestamp against the device clock                                                         | Counted from when the code arrived; the server still enforces the wait                               |
| Architect        | New-registration refreshes were going to be broadcast to every subscriber's open app                                              | Admin badges poll every 30 seconds instead                                                           |
| QA               | An upside-down entry zone was not flagged when no target was given                                                                | Fixed in the shared rule, so the API, web and phone all catch it                                     |
| UI/UX            | Registration filters stacked on desktop; long badge cut the instrument name on the phone's compact card                           | Fixed widths; "Upcoming" badge on the compact card                                                   |
| UI/UX            | After a trial ended, its "Your Free Trial Is Ready!" message still showed on the renewal screen                                   | Account messages are not shown on the status screen                                                  |
| UI/UX            | On the phone, the resend countdown read "Resend Code in": Android measured the semi-bold label as one line and cut off the second | While waiting it is plain text in the regular weight; the button appears when a new code can be sent |
| First-time user  | Granted a trial, a new subscriber saw the first-use tour on top of the trial welcome, which never showed                          | The welcome comes first; the tour follows once it is closed                                          |
| QA               | Renewed while the expired screen was open, the phone kept saying "Expired" for up to a minute after coming back to the app        | The status screen checks again on returning to the app (phone) or the tab (website)                  |
| UI/UX            | The account message's "OK" button was 43 points wide on a small phone, under the 44-point minimum                                 | Every button is at least as wide as it is tall                                                       |
| UI/UX            | The status screen said "Log out" where every other screen says "Sign out"                                                         | "Sign out" everywhere                                                                                |
| First-time user  | "Latest: Updated: …" and "Active trades" read awkwardly                                                                           | "Updated: …"; the page and tab are "Signals"                                                         |

The first-time user walk-through covered, on the Android emulator: sign up, verify the email, create the password,
email an enquiry, see "Enquiry Started", receive a 5-day trial and its welcome (once), see an upcoming trade, see it
activated and its stop-loss updated, see the expired screen and come back after renewal, and request a password reset.
The website's screens were checked in a browser, and its end-to-end suite covers expiry and renewal.

## Not built, or not verified

- **Email delivery** needs an email account, entered by the Super Admin on the configuration screen (or SMTP settings
  in the server's `.env`). Until then sign-up says it opens soon. Tests use the file transport; no real inbox was used.
- **iOS** was not run on a simulator or iPhone: this Mac has no Xcode. The native iOS app does compile: the "iOS
  build" workflow built it for the simulator on 15 November with Xcode 26.6, after it was changed to use the macOS 26
  runner. Installing on an iPhone needs an Apple Developer account for signing.
- **Push for account messages** reaches devices registered for push. A brand-new account registers a device only after
  it can see signals, so its first "Subscription Activated" arrives in the app and by email.
- **Expiry reminders** ("your trial ends tomorrow") are not built; the brief asked for them only where configured.
- **"Activation pending"** is not shown: the product does not record offline payments, so it cannot know.
- **Direction on an upcoming trade** is still required at publication. The trade model needs it, and it can be corrected.

## Second round, 15 November: configuration, free days, website and app alike

| Asked for                                              | What was done                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Email is not set up" at sign-up                       | The Super Admin sets the email account on the configuration screen (Gmail, Outlook or other), with a test button. Until then sign-up says it opens soon, before anything is typed, and offers WhatsApp and email. Administrators see a prompt on the dashboard |
| Configuration without code changes                     | One Configuration screen with six tabs, on the website and in the app: General, Contact, Email, Sign-up & trials, Signals, Legal. Super Admin only; read-only for other administrators; every change audited                                                   |
| Free trial of N days for any member, existing ones too | Any member, any time. Running access is extended after its last day; otherwise a trial starts. No extra confirmation for a second one                                                                                                                          |
| Better login and landing pages                         | A new landing page (what it is, how it works, an example signal clearly marked as an example, About us, the risk notice) and a two-panel login on wide screens; on phones, the form alone. The app's sign-in screens show the service's name                   |
| About us missing from the website                      | About us, Risk disclosure and Support in the website's Account page; About us is now a screen in the app too, readable before signing in                                                                                                                       |
| Website and app alike                                  | The website's signed-in area has the app's five places in the same order: Signals, Alerts, News, History, Account. News is new on the website                                                                                                                  |

Still website-only, on purpose: recording a compliance approval for publishing past results (dates and a signed review
reference), which the Legal tab in the app points to. Administrators' audit log, templates and trades list were already
website-only and are unchanged.

Found and fixed while building this round: the admin settings endpoint returned the whole settings row, so any secret
added to it would have reached every administrator. It now returns the platform settings only.
