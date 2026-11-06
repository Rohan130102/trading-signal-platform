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
