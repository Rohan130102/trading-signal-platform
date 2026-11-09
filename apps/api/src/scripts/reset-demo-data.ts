import { userInfo } from 'node:os';
import { env, isProduction } from '../config/env.js';
import { createAdapter } from '../db/prisma.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Clears demonstration data so the service can start fresh: every trade (drafts included), every signal event,
 * exit, execution record and announcement, and everything that hangs off them (deliveries, read marks, hidden
 * items, archive and removal marks).
 *
 * Kept: every account and subscription, instruments, message templates, settings, devices, compliance
 * approvals, and the whole audit log, which also gets an entry for this reset. Trade references and event
 * numbers carry on from where they were, so nothing new can be confused with something cleared.
 *
 * Safeguards: a dry run unless the exact confirmation is typed; refused in production unless explicitly
 * allowed; refused while public results are being published (wiping a published record would mislead); a
 * full copy of every cleared table is kept in a snapshot schema in the same database, written in the same
 * transaction as the deletion; the database's append-only protections are lifted only inside that transaction
 * and are back in force when it ends, whether it succeeds or fails.
 *
 * Usage:
 *   npm run data:reset-demo                                      what would be cleared (changes nothing)
 *   npm run data:reset-demo -- --confirm "RESET <database>"      clear it
 *   add --allow-production to run where NODE_ENV=production
 */

/** In deletion order: each table only references tables after it. */
export const CLEARED_TABLES = [
  'notification_reads',
  'push_deliveries',
  'fanout_metrics',
  'outbox_events',
  'user_hidden_items',
  'trade_archives',
  'trade_removals',
  'trade_execution_records',
  'trade_closures',
  'announcements',
  'signal_events',
  'trades',
] as const;

/** The append-only and immutability triggers that would otherwise refuse the deletion. */
const GUARDS = [
  ['signal_events', 'signal_events_append_only'],
  ['trade_closures', 'trade_closures_guard'],
  ['trade_execution_records', 'trade_execution_records_append_only'],
] as const;

/** Same lock every event insert takes, so no event can be written halfway through. */
const EVENT_LOCK = 7200101;

function argValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function snapshotName(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\..*$/, '')
    .replace(/^(\d{8})(\d{6})$/, '$1_$2');
  return `demo_reset_${stamp}`;
}

const prisma = new PrismaClient({ adapter: createAdapter(2) });

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of CLEARED_TABLES) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${table}`);
    out[table] = Number(row?.n ?? 0);
  }
  return out;
}

async function main(): Promise<void> {
  const [{ db } = { db: '' }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const expected = `RESET ${db}`;
  const confirm = argValue('--confirm');

  if (isProduction && !process.argv.includes('--allow-production')) {
    console.error('This is a production environment. Nothing changed. Add --allow-production if you really mean it.');
    process.exitCode = 1;
    return;
  }
  const now = new Date();
  const approval = await prisma.publicPerformanceApproval.findFirst({
    where: { revokedAt: null, effectiveFrom: { lte: now }, expiresAt: { gt: now } },
  });
  if (env.PUBLIC_PERFORMANCE_ENABLED && approval) {
    console.error(
      'Public results are being published right now. Clearing the record behind them would mislead readers. ' +
        'Revoke the approval or switch off PUBLIC_PERFORMANCE_ENABLED first. Nothing changed.',
    );
    process.exitCode = 1;
    return;
  }

  const before = await counts();
  console.log(`Database: ${db}`);
  console.log('Would clear:');
  for (const [table, n] of Object.entries(before)) console.log(`  ${table.padEnd(26)} ${n}`);
  console.log('Kept: accounts, subscriptions, instruments, templates, settings, devices, approvals, audit log.');

  if (confirm === undefined) {
    console.log(`\nDry run: nothing changed. To clear it, run again with --confirm "${expected}"`);
    return;
  }
  if (confirm !== expected) {
    console.error(`\nThe confirmation must be exactly "${expected}". Nothing changed.`);
    process.exitCode = 1;
    return;
  }

  const snapshot = snapshotName(now);
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${EVENT_LOCK})`);
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${snapshot}`);
      for (const table of CLEARED_TABLES) {
        await tx.$executeRawUnsafe(`CREATE TABLE ${snapshot}.${table} AS TABLE public.${table}`);
      }
      for (const [table, trigger] of GUARDS) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      }
      for (const table of CLEARED_TABLES) await tx.$executeRawUnsafe(`DELETE FROM ${table}`);
      for (const [table, trigger] of GUARDS) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
      const [chain] = await tx.$queryRaw<{ first_bad_seq: bigint | null }[]>`
        SELECT first_bad_seq FROM verify_signal_event_chain()`;
      if (chain?.first_bad_seq !== null && chain?.first_bad_seq !== undefined) {
        throw new Error('The event chain does not verify after the reset. Rolled back.');
      }
      await tx.appSettings.update({ where: { id: 1 }, data: { dataResetAt: now } });
      await tx.auditLog.create({
        data: {
          action: 'DEMO_DATA_RESET',
          targetType: 'database',
          targetId: db,
          metadata: { cleared: before, snapshotSchema: snapshot, operator: userInfo().username },
        },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  const after = await counts();
  const left = Object.values(after).reduce((a, b) => a + b, 0);
  console.log(`\nCleared. ${left === 0 ? 'Every listed table is now empty.' : `${left} rows remain (written since).`}`);
  console.log(`A full copy of what was cleared is in the schema "${snapshot}" of this database.`);
  console.log(`When you no longer need it: DROP SCHEMA ${snapshot} CASCADE;`);
  console.log('The reset is recorded in the audit log as DEMO_DATA_RESET.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
