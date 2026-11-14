# Onboarding, subscriptions, trials and signal refresh

What changed in this round, why, and where each requirement lives. Built on top of the existing
architecture: nothing was rebuilt, and accounts, subscriptions, trades and their history are kept.

## What already existed and was reused

| Need | Existing piece reused |
| --- | --- |
| Signed-in users without access | `evaluateSignalAccess` (one rule for REST, WebSocket and push). Expired users could already sign in. |
| Custom subscription length | `durationDays` (1–3660) on create and renew, inclusive calendar days in the business timezone. |
| Renewal semantics | `computeRenewal`: running subscriptions extend from expiry. Now also takes an activation date for expired ones. |
| Temporary passwords | `newTemporaryPassword`, `mustChangePassword`, `tempPasswordExpiresAt`, forced change on next sign-in. |
| Pending trades | `PUBLISHED` ("Awaiting entry") and the separate `ACTIVATE` action. No new lifecycle state was added. |
| Audit trail | Append-only `audit_logs`, `signal_events`, `subscription_events`. |
| Push, live updates | The outbox worker, `push_deliveries`, Expo and Web Push transports, `pg_notify` channels. |
| History | Trades leave the live lists and appear in History as soon as they close. No approval step existed; a test now guards it. The public-performance compliance gate is unchanged. |

## Checklist

| # | Requirement | Where | Tests |
| --- | --- | --- | --- |
| 2 | Log In / Sign Up screen, email or username, show/hide password | web `login`, `signup`; mobile `(auth)/login`, `(auth)/signup` | e2e `onboarding.spec`, mobile `auth-copy.test` |
| 3.1 | Five required fields, phone in E.164 (default +91), age with legal minimum | domain `registration.ts`; API `registration.service` | domain `registration.test`; API `registration.test` |
| 3.2 | Email code: 6 digits, 5 minutes, 5 tries, 60 s resend, hashed, rate limited | API `email-challenge.service` | API `registration.test` |
| 3.3 | Create password after verification, account enabled, no access | API `registration.service.complete` | API `registration.test` |
| 4 | WhatsApp enquiry with email fallback, never claimed as sent | domain `support.ts`; API `enquiries.service`; web/mobile `SubscriptionStatus` | domain `support.test`; API `enquiries.test` |
| 4.4 | Support WhatsApp and email set by the Master Admin only, audited | API `settings`; web/mobile settings | API `enquiries.test` |
| 5 | Identity, enquiry and access kept separate | `users.email_verified_at`, `users.enquiry_status`, `subscriptions.kind` | API `registration.test`, `trials.test` |
| 6 | New Registrations list with badge, filters, detail actions | API `registrations` in `subscribers`; web/mobile admin | API `registration.test` |
| 7 | Start / renew with any number of days, preview, no shortening | domain `subscription.ts`; API `subscribers.service` | domain `subscription.test`; API `trials.test` |
| 7.4, 8.4, 18 | Email + in-app + push for start, renewal and trial | API `notices.service`, `email` outbox, worker | API `trials.test` |
| 8 | Admin-granted free trials, never automatic, one greeting per grant | `trial_grants`; API `trials` in `subscribers.service`; `TrialGreeting` | API `trials.test` |
| 9 | Expired users sign in, see renewal screen, get no new private data | existing access rule; `SubscriptionStatus` screens | API `trials.test` (expiry and restore) |
| 10 | Forgot password: email code, then admin-issued temporary password | API `password-reset.service`; web/mobile admin list | API `password-reset.test` |
| 11 | Range trade published with no target or stop, activated later with levels | domain `lifecycle.ts`, `contracts.ts`; composer; Activate form | domain `lifecycle.test`; API `signals.test` |
| 12 | Clean correction wording for subscribers, full audit kept | domain `templates.ts`, `lifecycle.ts` | domain `lifecycle.test` |
| 13, 16 | Minimal copy, "Edit Levels Manually", consistent action names | domain `copy.ts`; all screens | domain `copy.test` |
| 14 | Signals page: Upcoming, Active, History | web `app/page.tsx`; mobile `feed.tsx` | e2e, mobile tests |
| 15 | Closed trades in History at once | existing queries | API `signals.test` |
| 17 | One reversible, additive migration | `20261114000000_onboarding_trials` | migrate from the previous schema |

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
- **Trials.** A trial sets the same access window a subscription does (`subscriptions.kind = TRIAL`) and is also
  kept in `trial_grants` for reporting and the one-time greeting. A second trial for the same person needs an
  explicit override. Starting a paid subscription replaces a running trial from the chosen date.
- **Payment confirmed.** The product does not track offline payment, so the "Activation pending" state is not shown.
- **Upcoming trades.** A range signal may be published without a target or stop-loss. It stays "Awaiting entry";
  activating it requires the final entry, at least one target and a stop-loss, and updates the same trade. The
  original range stays in its timeline. Single-price signals and range signals with levels are unchanged.
- **Corrections.** Subscribers see "Stop-loss updated: 64,920 (was 64,800)" and no reason or name. The reason, the
  administrator and every earlier value stay in the event payload and audit log, visible to administrators.
- **"Hypothetical".** Cards say "Signal result" for points measured from the signal's own entry and "Recorded entry"
  for an administrator-declared fill. The methodology note on History still says these are not anyone's profits.
