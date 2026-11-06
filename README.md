# SignalDesk

A platform for broadcasting structured trading signals to paying subscribers, with every later change to a trade delivered live and kept in a permanent history.

It communicates signals. **It does not place orders or connect to brokers**, and it never assumes anyone acted on a signal.

> **Status: ready for local development and testing. Not ready for real subscribers.** Compliance review is a hard blocker,
> and deployment and real-device push are unverified. See [docs/FINAL_AUDIT.md](docs/FINAL_AUDIT.md).

## What it does

The main product is the **native Android and iOS app** in `apps/mobile` (React Native, Expo, TypeScript). The web app stays alongside it, and both use the same API. See [docs/MOBILE.md](docs/MOBILE.md).

**Administrators** publish a signal in a few keystrokes: levels are calculated per instrument and previewed before anything is sent. They then activate, move stops, book partial profit, close and correct trades, manage subscribers, and watch delivery health and internal performance.

**Subscribers** get a live feed on their phone, see the current levels of every active trade, and can search history. Updates always read as updates, tied to their trade.

**Visitors** see a service description and risk disclosure. Public results are built, but closed behind two independent compliance keys.

## Quick start

Needs Node.js 22.18 or newer. PostgreSQL comes along as a project dependency, so nothing else needs installing for development.

```bash
npm install
```

```bash
node scripts/setup-env.mjs
```

```bash
npm run dev
```

The first run builds and migrates, then the app is at <http://localhost:3000>. In a second terminal, create your administrator:

```bash
npm run admin:create -- you "Your Name"
```

It prints a temporary password once. Sign in, choose a password and set up two-step verification with an authenticator app. Then create a subscriber from **Subscribers** and publish from **New signal**.

Before anything else, check the instrument assumptions: see [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md).

## Commands

| Command                                                     | Purpose                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                               | Database, API with worker, and web app                                                                                           |
| `npm run build`                                             | Production build of everything                                                                                                   |
| `npm run test:unit`                                         | Domain logic                                                                                                                     |
| `npm run test:integration`                                  | Real API, worker and PostgreSQL. Starts its own                                                                                  |
| `npm run test:e2e`                                          | Browser journeys. First: `PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium webkit`, and run with the same variable set |
| `npm run test:perf`                                         | Measured latency and throughput                                                                                                  |
| `npm run mobile`                                            | Start the phone app's development server. See [docs/MOBILE.md](docs/MOBILE.md)                                                   |
| `npm run test:mobile`                                       | The phone app's component and logic tests                                                                                        |
| `npm run lint`, `npm run typecheck`, `npm run format:check` | Static checks                                                                                                                    |
| `npm run db:migrate`, `npm run db:seed`                     | Database setup                                                                                                                   |
| `npm run admin:create -- <login> "<Name>"`                  | Provision an administrator                                                                                                       |
| `npm run admin:reset -- <login>`                            | Break-glass administrator recovery                                                                                               |
| `npm run vapid:generate`                                    | Web Push keys                                                                                                                    |
| `npm run openapi`                                           | Regenerate `docs/openapi.json`                                                                                                   |

## Layout

```
packages/domain    Pure logic: decimals, levels, state machine, P&L, subscriptions, templates, contracts
apps/api           NestJS REST and WebSocket, background worker, Prisma schema and migrations
apps/web           Next.js PWA: public, subscriber and administrator screens
e2e                Playwright journeys
scripts, deploy    Local tooling, performance harness, proxy, backups
docs               Everything below
```

## Documentation

| Document                                                 | Contents                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| [FINAL_AUDIT.md](docs/FINAL_AUDIT.md)                    | **Start here.** Readiness, evidence, findings, what is not done |
| [ASSUMPTIONS.md](docs/ASSUMPTIONS.md)                    | Decisions made for you, some of which change real numbers       |
| [COMPLIANCE_CHECKLIST.md](docs/COMPLIANCE_CHECKLIST.md)  | Regulatory questions that must be answered before launch        |
| [REQUIREMENTS.md](docs/REQUIREMENTS.md)                  | Each requirement, its implementation and its verification       |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)                  | System design and why                                           |
| [DATABASE.md](docs/DATABASE.md)                          | Schema and the guarantees the database enforces                 |
| [API.md](docs/API.md), [openapi.json](docs/openapi.json) | Interfaces                                                      |
| [SECURITY.md](docs/SECURITY.md)                          | Threat model and controls                                       |
| [TESTING.md](docs/TESTING.md)                            | Test strategy, results, measurements                            |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)                      | Running it for real, monitoring, backups                        |
| [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)                | Visual language                                                 |
