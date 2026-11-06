// Runs a real PostgreSQL server from project-local binaries, so development and tests need no
// system install. Production uses a managed or self-hosted PostgreSQL instead (docs/DEPLOYMENT.md).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.DEV_DB_PORT ?? 54329);
const databaseDir = resolve(process.env.DEV_DB_DIR ?? '.data/pg');
const database = process.env.DEV_DB_NAME ?? 'signaldesk';

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'signaldesk',
  password: 'signaldesk',
  port,
  persistent: true,
  onLog: () => {},
  onError: (m) => console.error('[postgres]', m),
});

if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase(database);
} catch {
  // Already exists from a previous run.
}
console.log(`PostgreSQL ready on postgresql://signaldesk:signaldesk@localhost:${port}/${database}`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
