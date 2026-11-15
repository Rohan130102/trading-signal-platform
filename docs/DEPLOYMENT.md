# Deployment

> **Not exercised.** No Docker daemon was available where this was built, so `Dockerfile`, `docker-compose.yml`, `deploy/Caddyfile`
> and the CI workflow have never run. YAML and shell syntax were checked. The application itself was tested as plain Node
> processes with production builds. Expect to fix small things on the first run, and do it on staging.
>
> **Do not take real subscribers until [COMPLIANCE_CHECKLIST.md](COMPLIANCE_CHECKLIST.md) is complete.**

## What needs to run

| Process       | Command                                             | Notes                                                                                                       |
| ------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| PostgreSQL    | Managed service recommended                         | Point-in-time recovery is worth paying for                                                                  |
| API           | `node apps/api/dist/main.js`                        | Needs a host that keeps WebSockets open. **Pure serverless platforms will not work.** Horizontally scalable |
| Worker        | `node apps/api/dist/worker.js`                      | At least one. Several is safe                                                                               |
| Web           | `node apps/web/.next/standalone/apps/web/server.js` | Stateless                                                                                                   |
| Reverse proxy | Caddy config in `deploy/`                           | Terminates HTTPS. Routes `/api/*` and `/ws` to the API, everything else to the web                          |

Browsers must see one origin. Web Push also requires HTTPS.

## Environments

Keep development, staging and production separate, each with its own database, `APP_ENCRYPTION_KEY` and VAPID keys. All settings
are validated at startup: a process with bad configuration refuses to start and says why. See `.env.example`.

Production requires `NODE_ENV=production`, `https://` in every `APP_ORIGINS` entry, and `TRUST_PROXY_HOPS` equal to the number of
proxies in front of the API. Keep `PUBLIC_PERFORMANCE_ENABLED=false` unless compliance review says otherwise.

## Email

Sign-up codes, recovery codes, subscription enquiries to support and account messages are sent by email. Without it, the
sign-up form still takes the person's details, but no code can be sent: the website then says so and offers to send the
details to the team on WhatsApp (or by email when there is no WhatsApp number). Nothing pretends to be sent.

**The usual way: the configuration screen.** The Super Admin opens Configuration, Email (website or app), picks Gmail,
Outlook or Other, enters the sending address and its password (for Gmail an app password), saves, and sends a test email.
No server change or restart is needed. The password is encrypted with `APP_ENCRYPTION_KEY` and never shown again.

**Or on the server**, with the settings below. Details saved on the configuration screen take precedence; the file
transport, used in development and tests, takes precedence over both.

| Setting                                 | Notes                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `EMAIL_TRANSPORT`                       | `smtp` for real delivery, `disabled` (default) for none. `file` is for development and is refused in production |
| `EMAIL_FROM`                            | The sender, such as `Signal Desk <no-reply@yourdomain>`                                                         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Gmail: `smtp.gmail.com`, `587`, `false` (STARTTLS, required)                                                    |
| `SMTP_USER`, `SMTP_PASS`                | Keep the password in a secret manager or the server's `.env` only                                               |

"Sent" in the app means the provider accepted the message. Whether it reached an inbox is not observable.

## Native app settings

| Setting                      | Default                           | Notes                                                                             |
| ---------------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| `EXPO_PUSH_ENABLED`          | `true`                            | Set `false` to stop native push entirely                                          |
| `EXPO_PUSH_API_URL`          | `https://exp.host/--/api/v2/push` | Only tests change this                                                            |
| `EXPO_ACCESS_TOKEN`          | Not set                           | Needed if you turn on enhanced push security in your Expo project. Keep it secret |
| `EXPO_RECEIPT_DELAY_SECONDS` | `900`                             | How long after sending to ask Expo whether Apple or Google took the message       |
| `EXPO_RECEIPT_POLL_SECONDS`  | `60`                              | How often the worker checks for receipts that are due                             |

The phone app connects from anywhere, so the API must be reachable over HTTPS on a public address, and `/ws` must allow WebSockets.
Building the app itself is covered in [MOBILE.md](MOBILE.md).

## Build notes that will otherwise bite you

- **Do not have `NODE_ENV=development` set during `npm run build`.** Next.js fails with a confusing prerender error.
- `API_ORIGIN` is baked into the web build's rewrites, and `NEXT_PUBLIC_WS_URL` into its client code. Leave the latter empty when `/ws` is on the same origin as the site.
- Client code cannot read runtime environment. Changing either value means rebuilding.

## First deployment with Docker Compose

```bash
cat > .env <<'CONFIG'
DOMAIN=signals.example.com
POSTGRES_PASSWORD=choose-a-long-random-value
APP_ENCRYPTION_KEY=output-of-openssl-rand-base64-32
VAPID_PUBLIC_KEY=from-npm-run-vapid-generate
VAPID_PRIVATE_KEY=from-npm-run-vapid-generate
VAPID_SUBJECT=mailto:ops@example.com
CONFIG
```

```bash
docker compose build --build-arg API_ORIGIN=http://api:4000
```

```bash
docker compose up -d
```

The `migrate` service applies migrations and seeds reference data before the API starts. Then create the first administrator:

```bash
docker compose exec api sh -c 'cd apps/api && node dist/scripts/create-admin.js you "Your Name"'
```

It prints a temporary password once. Sign in, replace it, enrol MFA and save the recovery codes.

Then fill in **Settings**: support contact, legal entity, disclosures, timezone. Review the default point values under **Instruments**.

## On an Oracle Cloud Always Free server

This stack runs on one Ampere A1 VM (arm64, 2 OCPU / 12 GB, Ubuntu 24.04), within Oracle's Always Free allowance. Things
that differ from a plain Ubuntu host:

- **Two firewalls.** Open TCP 80 and 443 in the VCN's security list, and in the VM's own iptables: Oracle's image ends the
  INPUT chain with a REJECT rule, so insert an ACCEPT for 80 and 443 before it and save with `netfilter-persistent save`.
- **Capacity.** Free-tier accounts often get "Out of capacity" for A1 shapes. Retrying works eventually; Pay As You Go
  accounts get capacity more easily and keep the same free allowance.
- **A free name for HTTPS.** Caddy needs a DNS name for its certificate; a DuckDNS name pointing at the VM's public IP
  works. Set it as `DOMAIN` in `.env`.
- **Backups on the host.** `deploy/backup.sh` expects `pg_dump` on the host. With everything in containers, run
  `docker compose exec -T postgres pg_dump …` and pipe it through the same `openssl enc` command, from cron. Keep the
  passphrase and a copy of the backups somewhere other than the VM, and rehearse a restore into a scratch database.
- **Moving an existing database in.** `pg_dump --format=custom --no-owner --no-privileges` from the old host, then
  `pg_restore --no-owner --no-privileges` into the empty `postgres` service before `migrate` runs. Copy the old
  `APP_ENCRYPTION_KEY` into `.env` too, or MFA secrets and the saved email password cannot be decrypted.

## App updates

The API serves over-the-air updates for the native app ([MOBILE.md](MOBILE.md#updates-without-a-new-apk)). To switch
them on:

1. Generate the key pair once: `npx expo-updates codesigning:generate --key-output-directory <private folder>
--certificate-output-directory code-signing --certificate-validity-duration-years 10 --certificate-common-name
"SignalDesk app updates"` in `apps/mobile`. Commit only `code-signing/certificate.pem`. Keep `private-key.pem`
   off the server's disk except in `.env`, and keep one copy somewhere safe: without it, phones need a new APK.
2. Put it in `.env` as one line: `APP_UPDATES_SIGNING_KEY=` followed by `base64 < private-key.pem | tr -d '\n'`.
   Create `app-updates/` next to `docker-compose.yml`, owned by the user who publishes. `docker compose up -d api`.
3. Build an APK that contains the certificate (any build after it was committed). Older APKs never check.

To publish, copy one export into `app-updates/android/<runtime version>/` under a temporary name and rename it into
place, so a half-copied update is never served:

```bash
RUNTIME=$(cat runtime-version.txt); STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ssh server "mkdir -p ~/signaldesk/app-updates/android/$RUNTIME"
tar -C update -c . | ssh server "mkdir ~/signaldesk/app-updates/android/$RUNTIME/.incoming-$STAMP && tar -x -C ~/signaldesk/app-updates/android/$RUNTIME/.incoming-$STAMP && mv ~/signaldesk/app-updates/android/$RUNTIME/.incoming-$STAMP ~/signaldesk/app-updates/android/$RUNTIME/$STAMP"
```

The newest folder (by its UTC name) is what phones get. To withdraw an update, publish a newer empty folder holding
only a file named `rollback`: phones go back to the code inside their APK. Deleting a folder brings back the one
before it for phones that have not yet downloaded it. Keep older folders for a day or two; a phone that started
downloading one finishes from it.

## Without containers

```bash
npm ci
```

```bash
npm run build
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Then run the three processes in the table above under a process manager, with environment from your secret store.

## Upgrades

Migrations are forward-only and run before new code starts. Back up first. Because API and worker instances can overlap during a
rollout, keep each migration backward compatible with the previous release.

## Monitoring

| What            | How                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Liveness        | `GET /health/live`. The process is up                                                                            |
| Readiness       | `GET /health/ready`. 503 when the database is unreachable. Blocked at the public proxy                           |
| Delivery health | Admin → Delivery health: worker heartbeat, queue depth, push results, live latency percentiles                   |
| Logs            | JSON lines on stdout. Failed or slow requests, with `requestId`. Ship them somewhere and alert on `level: error` |
| Errors          | No error-tracking service is integrated. Add one at `common/log.ts`                                              |

Alert on: readiness failures; worker heartbeat older than 60 s; any `DEAD` outbox row; push failure rate; live p95 over 2 s.

## Backup and restore

The database is the only stateful component. **Its contents include personal data and financial records, so backups are encrypted.**

```bash
DATABASE_URL=... BACKUP_PASSPHRASE_FILE=/secure/passphrase ./deploy/backup.sh /secure/backups
```

```bash
DATABASE_URL=... BACKUP_PASSPHRASE_FILE=/secure/passphrase ./deploy/restore.sh /secure/backups/signaldesk-20261105T000000Z.dump.enc
```

`restore.sh` refuses a non-empty database, and verifies the signal history's hash chain afterwards. Copy backups off the host. Keep
`APP_ENCRYPTION_KEY` backed up separately: without it, administrators must re-enrol MFA. Neither script has been run yet, because
`pg_dump` was not available here. **Rehearse a restore before you depend on it.**

Suggested target: daily logical backup plus managed point-in-time recovery, with a restore rehearsal each quarter.

## Administrator locked out

Lost both the password and recovery codes:

```bash
npm run admin:reset -- <loginId>
```

Needs shell and database access. It ends sessions, clears MFA, prints a temporary password and leaves an audit record.

## Scaling

One API instance was measured holding 1,000 sockets ([TESTING.md](TESTING.md)). Higher counts were not measured. Add API instances behind the proxy for more: each
tails the event log independently and enforces access itself. Add workers for push throughput. If push volume outgrows the queue tables, BullMQ can sit behind the same outbox.
