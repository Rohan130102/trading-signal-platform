# API

The full contract is [openapi.json](openapi.json), generated from the controllers and the same Zod schemas that validate
requests, so it cannot drift from what the server enforces. Regenerate with `npm run openapi`. A running server serves it at
`/api/v1/openapi.json`.

## Conventions

| Topic                   | Rule                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base path               | `/api/v1`. Health checks are at `/health/live` and `/health/ready`, outside it.                                                                                                                                                                                                                      |
| Authentication          | Browsers: session cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production. Native apps: `Authorization: Bearer`, from `POST /auth/token`. Routes are private unless explicitly public. A bearer token is never combined with a cookie: if one is sent and invalid, the request is refused.        |
| State-changing requests | Must carry an allowed `Origin` header, otherwise `403 BAD_ORIGIN`. A request with a bearer token and no `Origin` is exempt, as are the native sign-in, sign-up and recovery steps (`/auth/token`, `/auth/register*` except `/auth/register/complete`, `/auth/password-reset*`), which use no cookie. |
| Prices and quantities   | Strings, such as `"3300.50"`. Never JSON numbers.                                                                                                                                                                                                                                                    |
| Unknown fields          | Rejected with `422`.                                                                                                                                                                                                                                                                                 |
| Idempotency             | Writes that could be repeated take an `idempotencyKey` (UUID). Repeating returns the original result.                                                                                                                                                                                                |
| Concurrency             | Trade commands take `expectedVersion`. A stale version returns `409 STALE_VERSION`.                                                                                                                                                                                                                  |
| Caching                 | Everything is `Cache-Control: no-store` except `/public/info`.                                                                                                                                                                                                                                       |

## Errors

```json
{
  "error": { "code": "STALE_VERSION", "message": "A sentence you can show a person.", "details": {}, "requestId": "…" }
}
```

| Status | Meaning                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Unreadable request                                                                                                                                                  |
| 401    | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TEMP_PASSWORD_EXPIRED`                                                                                                   |
| 403    | `FORBIDDEN`, `BAD_ORIGIN`, `SESSION_STEP_REQUIRED` (with `details.next`), `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_SCHEDULED`, `SUBSCRIPTION_NONE`, `ACCOUNT_DISABLED` |
| 404    | Not found, including anything you may not know exists                                                                                                               |
| 409    | `STALE_VERSION`, `INVALID_TRANSITION`, `WIDENS_RISK`, `DUPLICATE_SIGNAL`, `DRAFT_CHANGED`, `LOGIN_ID_TAKEN` and similar                                             |
| 413    | Body over 64 KB                                                                                                                                                     |
| 422    | Validation or a business rule, with `details.issues` where a field is at fault                                                                                      |
| 429    | `TOO_MANY_ATTEMPTS`, `RATE_LIMITED`                                                                                                                                 |
| 503    | `NOT_READY` from the readiness check                                                                                                                                |

## Route groups

| Prefix                                       | Who                          | Purpose                                              |
| -------------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| `/public/*`, `/health/*`                     | Anyone                       | Service information, gated results, health           |
| `/auth/*`                                    | Signing in                   | Login, logout, password, MFA, current session state  |
| `/feed`, `/trades/*`, `/instruments/symbols` | Active subscription or admin | Signals. Enforced on every request                   |
| `/push/*`, `/me/*`                           | Signed in                    | Web and native devices, and notification preferences |
| `/admin/*`                                   | Administrator with MFA       | Everything else                                      |

## Sign-up and recovery

Public, rate limited per address and per client. The answer is the same whether or not an address has an account.

| Route                                             | Purpose                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`                             | `{ firstName, lastName, email, mobile, age, consent }`. Emails a 6-digit code. Returns `{ challengeId, email, resendAvailableAt, expiresAt }` |
| `POST /auth/register/resend`                      | A new code, at most once a minute. The old code stops working                                                                                 |
| `POST /auth/register/verify`                      | `{ challengeId, code }`. Five tries per code, five minutes. Returns a single-use `setupToken` (15 minutes)                                    |
| `POST /auth/register/complete`, `/complete-token` | `{ setupToken, password }`. Creates the account with no access and signs in: a cookie (web) or `{ token, expiresAt }` (native)                |
| `POST /auth/password-reset`, `/resend`, `/verify` | Prove the address; `verify` files one request for the administrators and returns `{ status: 'REQUESTED' }`                                    |

## Native apps

| Route                  | Purpose                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /auth/token`     | Same credentials and throttling as `/auth/login`. Returns `{ token, expiresAt }`, and sets no cookie |
| `POST /push/devices`   | Register `{ token, platform, deviceLabel }`. A token already known moves to the current user         |
| `DELETE /push/devices` | Remove `{ token }`, only if it belongs to the caller                                                 |

## Subscriber experience

| Route                                                               | Purpose                                                                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /signals`                                                      | Trades with up to four latest updates, newest activity first. `symbols`, `direction`, `status` (`ALL`, `OPEN`, `AWAITING`, `LIVE`, `CLOSED`), cursor `before`                |
| `GET /notifications`, `POST /notifications/read`                    | Every broadcast event with read state; mark all (`{ all, upToSeq }`), some (`{ eventIds }`) or one trade (`{ tradeId }`)                                                     |
| `GET /announcements`                                                | Published, unexpired, not hidden; pinned first                                                                                                                               |
| `POST /me/hidden`, `DELETE /me/hidden/:type/:id`                    | Hide or show a trade or announcement for the caller only                                                                                                                     |
| `GET /me/device`, `POST /me/onboarding`, `POST /me/security-events` | This phone's binding; tour finished; an observed screen capture                                                                                                              |
| `POST /me/enquiries`, `GET /me/enquiries/:id`                       | A subscription enquiry `{ channel: WHATSAPP \| EMAIL, purpose, whatsappUnavailable, idempotencyKey }`. Outcome `LINK_OPENED`, `EMAIL_QUEUED`, `EMAIL_SENT` or `EMAIL_FAILED` |
| `GET /me/notices`, `POST /me/notices/read`                          | Messages about the caller's own account, such as a subscription starting                                                                                                     |
| `POST /me/trial-greeting/:grantId`                                  | The trial welcome was shown; no device shows it again                                                                                                                        |
| `POST /push/opened`                                                 | A notification was opened on this device                                                                                                                                     |

`POST /auth/token` now takes `installationId` and `platform`. A subscriber without an installation identifier gets
`426 APP_UPDATE_REQUIRED`; one bound to another account gets `403 DEVICE_BOUND`.

## Administration added

| Route                                                                                                      | Purpose                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/admin/announcements` (+ `/:id/publish`, `schedule`, `unschedule`, `archive`, `restore`, `purge`, `bulk`) | Announcement lifecycle. Every change carries `expectedVersion`. The original `{ message }` form still publishes at once |
| `/admin/announcement-templates`                                                                            | Reusable templates                                                                                                      |
| `/admin/trade-archive` (+ `/preview`, `/before`, `/restore`)                                               | Archive finished trades. Bulk changes need the confirmed count                                                          |
| `/admin/instruments/:id/archive`, `/restore`                                                               | Retire an instrument without touching its trades                                                                        |
| `/admin/subscribers/:id/devices`, `/admin/devices/:id/release`                                             | Review and release phone bindings                                                                                       |
| `/admin/admins` (+ `/:id/status`, `/:id/master`, `/:id/reset`)                                             | Master Admin only. Register and manage administrators                                                                   |
| `/admin/trade-removals` (+ `/restore`)                                                                     | Master Admin only. Remove finished trades from subscriber screens: reason, typed `REMOVE`, confirmed count              |
| `PUT /admin/subscribers/:id/screenshots`                                                                   | Master Admin only. `{ screenshotsAllowed: true \| false \| null }`, null follows the platform default                   |
| `PUT /admin/settings`                                                                                      | Master Admin only. Service text and platform rules                                                                      |
| `PUT /admin/settings/support`                                                                              | Master Admin only. `{ supportWhatsapp, supportEmail }`, audited with before and after                                   |
| `GET /admin/registrations`, `GET /admin/inbox`                                                             | Self-registered people with filters; counts behind the New Registrations and Password Resets badges                     |
| `POST /admin/subscribers/:id/start`                                                                        | Any number of days, optional `activationDate`. Refused on running paid access; `confirmShorter` to cut a trial short    |
| `POST /admin/subscribers/:id/trial`                                                                        | A free trial for any number of days up to 90. Never on running access; a second needs `allowRepeat`                     |
| `POST /admin/subscribers/:id/renew`                                                                        | Now also takes `activationDate`, used when the subscription has expired                                                 |
| `PUT /admin/subscribers/:id/enquiry`, `POST /admin/subscribers/:id/seen`                                   | Move an enquiry along; take a registration off the badge                                                                |
| `/admin/password-resets` (+ `/:id/issue`, `/complete`, `/dismiss`)                                         | Recovery requests. `issue` returns a 24-hour temporary password once and signs the person out everywhere                |
| `/me/history/clear`, `/me/history/restore`                                                                 | A subscriber clears finished trades from their own lists, or brings them back                                           |

## Trade commands

`POST /admin/trades/:id/events`, discriminated by `action`:

`ACTIVATE`, `RECORD_EXECUTION`, `MOVE_STOP`, `MOVE_STOP_BREAKEVEN`, `TRAIL_STOP`, `TARGET_HIT`, `MODIFY_TARGETS`,
`BOOK_PARTIAL`, `CLOSE`, `URGENT`, `CANCEL`, `EXPIRE`, `CORRECT`.

`CORRECT` takes a `reason` and any of the fields below. It is allowed in every published state, including closed,
cancelled and expired.

| Field                                                           | What it corrects                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `entryLow`, `entryHigh`, `stopLoss`                             | The published levels                                                              |
| `targetPrices: [{ index, price }]`                              | Any target's price. Its reached state does not change                             |
| `targets`                                                       | Replaces the targets not yet reached. Kept for older apps                         |
| `actualEntry`                                                   | Records or changes the entry actually obtained. Every exit is re-measured from it |
| `activatedAt`                                                   | When the trade became active                                                      |
| `closureId` with `exitPrice`, `exitedAt`, `fees`, `closeReason` | One exit record                                                                   |

Instrument and direction cannot be corrected.

## Live stream

`GET /ws`, upgraded to a WebSocket. Authenticated by the session cookie, with an allowed `Origin`, or by `Authorization: Bearer`, where `Origin` is not checked because native apps send their own and a browser page cannot set this header.

| Direction       | Message                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| Client → server | `{ "type": "hello", "lastSeq": 1234 }`. Required before anything is sent                    |
| Client → server | `{ "type": "ping" }`                                                                        |
| Server → client | `{ "type": "ready", "headSeq": 1240 }`                                                      |
| Server → client | `{ "type": "event", "event": FeedEvent }`. Strictly increasing `seq`, from `lastSeq` onward |
| Server → client | `{ "type": "pong" }`                                                                        |
| Server → client | `{ "type": "denied", "reason": "SUBSCRIPTION_EXPIRED" }`, followed by a close               |

| Close code    | Meaning                            | What a client should do                                 |
| ------------- | ---------------------------------- | ------------------------------------------------------- |
| 4401          | Session ended                      | Stop, sign in again                                     |
| 4403          | No access                          | Stop, re-read `/auth/me`                                |
| 4400          | Bad message                        | Fix the client                                          |
| 4408          | Too many connections for this user | Close a tab                                             |
| Anything else | Network or restart                 | Reconnect with backoff, sending the last `seq` you hold |
