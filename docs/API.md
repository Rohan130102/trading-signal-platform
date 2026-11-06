# API

The full contract is [openapi.json](openapi.json), generated from the controllers and the same Zod schemas that validate
requests, so it cannot drift from what the server enforces. Regenerate with `npm run openapi`. A running server serves it at
`/api/v1/openapi.json`.

## Conventions

| Topic                   | Rule                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Base path               | `/api/v1`. Health checks are at `/health/live` and `/health/ready`, outside it.                                  |
| Authentication          | Session cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production. Routes are private unless explicitly public. |
| State-changing requests | Must carry an allowed `Origin` header, otherwise `403 BAD_ORIGIN`.                                               |
| Prices and quantities   | Strings, such as `"3300.50"`. Never JSON numbers.                                                                |
| Unknown fields          | Rejected with `422`.                                                                                             |
| Idempotency             | Writes that could be repeated take an `idempotencyKey` (UUID). Repeating returns the original result.            |
| Concurrency             | Trade commands take `expectedVersion`. A stale version returns `409 STALE_VERSION`.                              |
| Caching                 | Everything is `Cache-Control: no-store` except `/public/info`.                                                   |

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

| Prefix                                       | Who                          | Purpose                                             |
| -------------------------------------------- | ---------------------------- | --------------------------------------------------- |
| `/public/*`, `/health/*`                     | Anyone                       | Service information, gated results, health          |
| `/auth/*`                                    | Signing in                   | Login, logout, password, MFA, current session state |
| `/feed`, `/trades/*`, `/instruments/symbols` | Active subscription or admin | Signals. Enforced on every request                  |
| `/push/*`, `/me/*`                           | Signed in                    | Devices and notification preferences                |
| `/admin/*`                                   | Administrator with MFA       | Everything else                                     |

## Trade commands

`POST /admin/trades/:id/events`, discriminated by `action`:

`ACTIVATE`, `RECORD_EXECUTION`, `MOVE_STOP`, `MOVE_STOP_BREAKEVEN`, `TRAIL_STOP`, `TARGET_HIT`, `MODIFY_TARGETS`,
`BOOK_PARTIAL`, `CLOSE`, `URGENT`, `CANCEL`, `EXPIRE`, `CORRECT`.

## Live stream

`GET /ws`, upgraded to a WebSocket. Authenticated by the session cookie. The `Origin` header must be allowed.

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
