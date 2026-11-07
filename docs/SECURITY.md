# Security

## Threat model

| Threat                                       | Safeguards                                                                                                                                                                                                                                                       | Verified by                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Reaching paid signals without paying**     | Default-deny guard; access decided from the database on every request; private responses `no-store`; no signal data in server-rendered pages or bundles; the service worker caches none of it                                                                    | `authorization.test.ts` walks every route in the live route table; `security.spec.ts` |
| **Expired subscribers keeping access**       | One access rule shared by REST, WebSocket and push; sockets know their exact expiry and are swept every 5 s; push re-checks immediately before sending; the client drops private data from memory                                                                | `subscription.test.ts`, `push.test.ts`, `expiry.spec.ts`                              |
| **Credential compromise**                    | Argon2id; only token hashes stored; `HttpOnly` cookies; forced replacement of temporary passwords; sign-in throttling; other devices signed out on password change; revocation applies to the very next request                                                  | `auth.test.ts`                                                                        |
| **Admin impersonation**                      | Mandatory TOTP MFA; codes single-use even inside their validity window; recovery codes hashed and single-use; 12-hour sessions with a 2-hour idle limit; MFA secrets encrypted at rest                                                                           | `auth.test.ts`                                                                        |
| **Forged or altered messages**               | Only administrators can publish; every action attributed; published text stored verbatim; append-only triggers; hash chain                                                                                                                                       | `signals.test.ts`                                                                     |
| **Notification leakage**                     | Web Push payloads encrypted end to end; hide-preview option; a device stops receiving when its session ends; re-registering an endpoint moves it to the current user                                                                                             | `push.test.ts`, which decrypts real payloads                                          |
| **Data manipulation**                        | Parameterized queries only; strict validation; database constraints; object-level checks; position data never in broadcast payloads                                                                                                                              | `signals.test.ts`, `authorization.test.ts`                                            |
| **Fraudulent historical results**            | No backdating; closures immutable; corrections visible; bases never mixed; "verified" unreachable; cancelled and untriggered signals never dropped; public results gated                                                                                         | `signals.test.ts`, `public.test.ts`, domain tests                                     |
| **Duplicate publications**                   | Idempotency keys, re-checked under a row lock; a duplicate-signal warning                                                                                                                                                                                        | `signals.test.ts`, `admin.spec.ts`                                                    |
| **Malicious input**                          | Zod on every input; React escaping; template fields allow-listed; 64 KB body limit; 1 KB WebSocket message limit                                                                                                                                                 | `auth.test.ts`, `security.spec.ts`                                                    |
| **Server-side request forgery through push** | A subscriber supplies the push URL, so hosts are allow-listed and must be HTTPS                                                                                                                                                                                  | `push.test.ts`                                                                        |
| **A native session token being stolen**      | Kept in the device's secure storage, not backed up and not moved to another phone; only its hash is on the server; subject to the same revocation and expiry as any session; sent only over HTTPS in non-development builds, which refuse to start otherwise     | `mobile.test.ts`, `apps/mobile/test`                                                  |
| **Malicious content in a push notification** | Only a fixed set of in-app paths can be opened from notification data                                                                                                                                                                                            | `apps/mobile/test`, domain tests                                                      |
| **Sending to someone else's device**         | Device tokens are validated by shape, cannot be listed back, and can only be removed by their owner. Consider Expo's enhanced push security with `EXPO_ACCESS_TOKEN`                                                                                             | `mobile.test.ts`                                                                      |
| **Denial of service**                        | Request limit per signed-in session and, for anything else, per IP; slow sockets dropped; bounded page sizes; per-user socket cap. **Put real protection at the proxy or CDN too**                                                                               | `zz-reliability.test.ts`                                                              |
| **Cross-site attacks**                       | Origin check on all writes including login, waived only for a bearer token with no `Origin`, which a browser cannot forge from another site; `SameSite=Lax`; Origin check on WebSocket upgrade; nonce-based CSP with no inline scripts; `frame-ancestors 'none'` | `auth.test.ts`, `authorization.test.ts`, `security.spec.ts`                           |

## Authentication flow

1. Login sets an opaque 256-bit token. Only its SHA-256 goes into the database.
2. The session then has at most one required step, in this order: replace temporary password, enrol MFA (admin), verify MFA (admin). Until complete, only the routes for that step work, including at the WebSocket.
3. An unknown login ID runs the same password check as a known one, and returns the same error, so neither the message nor the timing reveals which IDs exist.

## Secrets

| Secret               | Where it lives                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENCRYPTION_KEY` | Secret manager. **Losing it means every administrator must re-enrol MFA** (`npm run admin:reset`). There is no rotation tool yet. |
| `VAPID_PRIVATE_KEY`  | Secret manager. Changing the pair invalidates every device's subscription.                                                        |
| `DATABASE_URL`       | Secret manager. Use the restricted role from `deploy/app-role.sql`.                                                               |

`.env` is ignored by git. `scripts/setup-env.mjs` creates a local one with mode 600. No default password exists anywhere:
`npm run admin:create` prints a temporary one once. Nothing logs passwords, tokens, request bodies or signal text.

## Dependencies

`npm audit --omit=dev` reports 0 vulnerabilities. Development tooling has 10 moderate advisories, all from `minimatch` through
ESLint. They do not ship and do not process untrusted input here. Versions are pinned exactly, with a lockfile.

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
