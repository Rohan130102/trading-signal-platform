# Security

## Threat model

| Threat                                       | Safeguards                                                                                                                                                                                                                                                                                                                                | Verified by                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Reaching paid signals without paying**     | Default-deny guard; access decided from the database on every request; private responses `no-store`; no signal data in server-rendered pages or bundles; the service worker caches none of it                                                                                                                                             | `authorization.test.ts` walks every route in the live route table; `security.spec.ts` |
| **Expired subscribers keeping access**       | One access rule shared by REST, WebSocket and push; sockets know their exact expiry and are swept every 5 s; push re-checks immediately before sending; the client drops private data from memory                                                                                                                                         | `subscription.test.ts`, `push.test.ts`, `expiry.spec.ts`                              |
| **Credential compromise**                    | Argon2id; only token hashes stored; `HttpOnly` cookies; forced replacement of temporary passwords; sign-in throttling; other devices signed out on password change; revocation applies to the very next request                                                                                                                           | `auth.test.ts`                                                                        |
| **Admin impersonation**                      | Mandatory TOTP MFA; codes single-use even inside their validity window; recovery codes hashed and single-use; 12-hour sessions with a 2-hour idle limit; MFA secrets encrypted at rest                                                                                                                                                    | `auth.test.ts`                                                                        |
| **Forged or altered messages**               | Only administrators can publish; every action attributed; published text stored verbatim; append-only triggers; hash chain                                                                                                                                                                                                                | `signals.test.ts`                                                                     |
| **Notification leakage**                     | Web Push payloads encrypted end to end; hide-preview option; a device stops receiving when its session ends; re-registering an endpoint moves it to the current user                                                                                                                                                                      | `push.test.ts`, which decrypts real payloads                                          |
| **Data manipulation**                        | Parameterized queries only; strict validation; database constraints; object-level checks; position data never in broadcast payloads                                                                                                                                                                                                       | `signals.test.ts`, `authorization.test.ts`                                            |
| **Fraudulent historical results**            | No backdating: every event is stamped by the server when it happens, and a corrected time is itself a new, dated, broadcast correction; closures immutable; corrections visible and flagged on every performance record; bases never mixed; "verified" unreachable; cancelled and untriggered signals never dropped; public results gated | `signals.test.ts`, `public.test.ts`, domain tests                                     |
| **Duplicate publications**                   | Idempotency keys, re-checked under a row lock; a duplicate-signal warning                                                                                                                                                                                                                                                                 | `signals.test.ts`, `admin.spec.ts`                                                    |
| **Malicious input**                          | Zod on every input; React escaping; template fields allow-listed; 64 KB body limit; 1 KB WebSocket message limit                                                                                                                                                                                                                          | `auth.test.ts`, `security.spec.ts`                                                    |
| **Server-side request forgery through push** | A subscriber supplies the push URL, so hosts are allow-listed and must be HTTPS                                                                                                                                                                                                                                                           | `push.test.ts`                                                                        |
| **A native session token being stolen**      | Kept in the device's secure storage, not backed up and not moved to another phone; only its hash is on the server; subject to the same revocation and expiry as any session; sent only over HTTPS in non-development builds, which refuse to start otherwise                                                                              | `mobile.test.ts`, `apps/mobile/test`                                                  |
| **Malicious content in a push notification** | Only a fixed set of in-app paths can be opened from notification data                                                                                                                                                                                                                                                                     | `apps/mobile/test`, domain tests                                                      |
| **Sending to someone else's device**         | Device tokens are validated by shape, cannot be listed back, and can only be removed by their owner. Consider Expo's enhanced push security with `EXPO_ACCESS_TOKEN`                                                                                                                                                                      | `mobile.test.ts`                                                                      |
| **Denial of service**                        | Request limit per signed-in session and, for anything else, per IP; slow sockets dropped; bounded page sizes; per-user socket cap. **Put real protection at the proxy or CDN too**                                                                                                                                                        | `zz-reliability.test.ts`                                                              |
| **Cross-site attacks**                       | Origin check on all writes including login, waived only for a bearer token with no `Origin`, which a browser cannot forge from another site; `SameSite=Lax`; Origin check on WebSocket upgrade; nonce-based CSP with no inline scripts; `frame-ancestors 'none'`                                                                          | `auth.test.ts`, `authorization.test.ts`, `security.spec.ts`                           |

## Authentication flow

1. Login sets an opaque 256-bit token. Only its SHA-256 goes into the database.
2. The session then has at most one required step, in this order: replace temporary password, enrol MFA (admin), verify MFA (admin). Until complete, only the routes for that step work, including at the WebSocket.
3. An unknown login ID runs the same password check as a known one, and returns the same error, so neither the message nor the timing reveals which IDs exist.

## Sign-up and recovery

- **Email codes.** Six random digits, valid five minutes, five tries per code, a new code at most once a minute, each new code replacing the last. Only an HMAC of the code keyed with `APP_ENCRYPTION_KEY` and bound to its challenge is stored, so a copy of the table cannot be used to try codes offline. A right code is cleared at once and cannot be replayed. Wrong tries are counted atomically before the comparison.
- **Limits.** Code emails per address per hour, new challenges and code checks per client address per hour (`EMAIL_CODE_IP_LIMIT_PER_HOUR`).
- **No enumeration.** Sign-up answers the same for a taken address, which gets an email saying it already has an account instead of a code. Recovery answers the same for an unknown address and sends it nothing.
- **Setup token.** Proving the address returns a 15-minute, single-use token for creating the password. Its use is claimed atomically, so two requests cannot create two accounts.
- **Recovery is administrator-managed.** A proved address files one request. An administrator issues a temporary password, shown once, stored only as a hash, valid 24 hours; the old password and every session stop working, and the person must replace it before anything else. The audit log records who issued it and never the password.
- **No paid access from sign-up.** A new account has no subscription and no trial; both come only from an administrator.
- **Emails never carry a password.** Codes are sent at once and never stored readable; other email is queued in the database.
- **The email account entered on the configuration screen.** Only the Master Admin can read or change it, or send a test.
  The password is encrypted with `APP_ENCRYPTION_KEY` (AES-256-GCM) before it is stored, is never returned by any endpoint
  (the screen learns only whether one is saved), and never appears in the audit log, which records which fields changed.
  `GET /admin/settings` returns the platform settings only, never the email account.

## Secrets

| Secret                                    | Where it lives                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENCRYPTION_KEY`                      | Secret manager. **Losing it means every administrator must re-enrol MFA** (`npm run admin:reset`). There is no rotation tool yet. |
| `VAPID_PRIVATE_KEY`                       | Secret manager. Changing the pair invalidates every device's subscription.                                                        |
| `DATABASE_URL`                            | Secret manager. Use the restricted role from `deploy/app-role.sql`.                                                               |
| `SMTP_PASS`                               | Secret manager, or the server's `.env` only. With Gmail, use an app password, never the account password.                         |
| Email account on the configuration screen | Database, encrypted with `APP_ENCRYPTION_KEY`. Never returned or logged. Losing the key means entering the password again.        |

`.env` is ignored by git. `scripts/setup-env.mjs` creates a local one with mode 600. No default password exists anywhere:
`npm run admin:create` prints a temporary one once. Nothing logs passwords, tokens, request bodies or signal text.

## Dependencies

`npm audit --omit=dev` reports 0 vulnerabilities. Development tooling has 10 moderate advisories, all from `minimatch` through
ESLint. They do not ship and do not process untrusted input here. Versions are pinned exactly, with a lockfile.

## One subscriber per phone

The native app signs in with an installation identifier. The server binds it to the first subscriber who signs in
on it and refuses any other subscriber there, after the password has been checked, so nothing about bindings leaks to
someone without it. Signing out does not release the binding. An administrator can release it (with a reason, kept in
the audit log), which also signs the old account out of that phone. Administrators are never bound.

- **Android:** derived from the platform's per-app device identifier and hashed on the phone. It survives clearing the
  app's data and reinstalling, and resets on a factory reset.
- **iPhone:** a random value in the Keychain, on this device only. It survives reinstalling and does not move to a new
  phone through a backup.
- **Limits:** neither is a hardware identity, and a modified app could send a different value. The binding stops casual
  account switching on one phone. Proof that the request comes from a genuine, unmodified app needs Play Integrity and
  App Attest, which need the store accounts. The website is not bound: a browser has no reliable identity.
- **Not limited:** how many phones one subscriber uses. No policy in the requirements set a per-account limit, so a
  replacement phone simply registers. Add a limit only once the business decides one.

## Screen capture

The Master Admin decides whether subscribers may capture signal screens: a platform default (blocked unless changed) and,
optionally, a choice for one subscriber. The app reads the rule from `/auth/me` (`security.screenshotsAllowed`), blocks
capture until it knows, and applies a change straight away. When capture is blocked, subscriber screens are protected as
below; administrator screens never are. These are the strongest controls each platform supports, and the limits are
unavoidable:

| Platform | What happens                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Android  | The window is marked secure (`FLAG_SECURE`). Screenshots, recordings and the recent-apps preview are blank. Enforced by Android.                                                                                                                                                                                                                             |
| iPhone   | Apple has no supported API to block screenshots. Expo's module hides content from captures on recent iOS using the secure-text layer, which Apple does not document for this, so it is best effort. The app-switcher preview is blurred, and a screenshot is noticed after the fact and logged. No watermark is drawn over the content (the owner's choice). |
| Web      | No protection is claimed, and the setting has no effect: a browser cannot stop screenshots, screen recording or another camera. Disabling right-click is not protection.                                                                                                                                                                                     |

A logged screenshot records only the fact, the screen and the time, capped at 30 an hour per subscriber. A
development bundle can switch capture back on for automated visual checks (`EXPO_PUBLIC_E2E_ALLOW_CAPTURE=1`); it is
ignored in every preview and production build, where `__DEV__` is false.

## Announcements

Plain text only: control characters are removed and nothing is rendered as HTML. A link button accepts only `https://`
addresses without credentials, is checked by the server and the database, and opens in the browser after a
confirmation.

## Known limits

- The general request limit is per instance and held in memory. Sign-in throttling is shared through PostgreSQL.
- A session gets its own request allowance only after it has passed authentication, so subscribers sharing a mobile network's public address do not use up each other's. A made-up credential earns nothing and counts against its address.
- Failed sign-ins still count per address as well as per login ID: 40 in 15 minutes blocks sign-in from that address for the rest of the window. On a shared mobile address, someone else's failures could block a new sign-in. People already signed in are not affected.
- The hash chain detects tampering, but someone with database superuser access could rewrite it. Anchor the latest hash externally for stronger evidence.
- The MFA encryption key has no rotation procedure.
- There is no independent penetration test. Get one before handling real subscribers.
- `TRUST_PROXY_HOPS` must match your deployment, or client IPs, and so IP throttling, can be spoofed through `X-Forwarded-For`.

## Reporting

Set a contact for security reports before launch. None is configured.

## Demonstration data reset

`npm run data:reset-demo` clears trades, events, exits, executions and announcements, and what hangs off them, so the
service can start fresh. It is a dry run unless given `--confirm "RESET <database>"`; it refuses in production (unless
`--allow-production`) and while public results are being published. In one transaction it copies every cleared table
into a snapshot schema `demo_reset_<timestamp>` in the same database, lifts the append-only triggers for the deletion
only, puts them back, verifies the event chain and writes a `DEMO_DATA_RESET` audit entry. Accounts, subscriptions,
instruments, templates, settings, devices, approvals and the audit log are kept; trade references and event numbers
carry on, so nothing new can be confused with something cleared. Drop the snapshot schema when it is no longer needed.
