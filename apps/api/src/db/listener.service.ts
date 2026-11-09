import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { env } from '../config/env.js';
import { log } from '../common/log.js';

export const CH_EVENTS = 'signal_events';
export const CH_ACCESS = 'access_changes';
export const CH_PUSH = 'push_ready';
/** Something subscribers see changed without a new event: open apps reload their lists. */
export const CH_REFRESH = 'screen_refresh';

/** Sent when the surrounding transaction commits, to every API instance. */
export async function notifyRefresh(
  tx: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number> },
  reason: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_notify('screen_refresh', ${reason})`;
}

type Handler = (payload: string) => void;

/**
 * Dedicated connection for LISTEN. NOTIFY is only a low-latency wake-up: every consumer also polls,
 * so a dropped connection delays work by a poll interval and never loses it.
 */
@Injectable()
export class ListenerService implements OnModuleDestroy {
  private client: pg.Client | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly reconnectHandlers = new Set<() => void>();
  private stopped = false;
  private retry: NodeJS.Timeout | null = null;

  on(channel: string, handler: Handler): void {
    const set = this.handlers.get(channel) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(channel, set);
    if (this.client) void this.client.query(`LISTEN ${channel}`).catch(() => undefined);
  }

  onReconnect(handler: () => void): void {
    this.reconnectHandlers.add(handler);
  }

  async start(): Promise<void> {
    if (this.client || this.stopped) return;
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    client.on('error', (error) => {
      log('warn', 'listener_connection_error', { error: error.message });
      this.scheduleReconnect(client);
    });
    client.on('end', () => this.scheduleReconnect(client));
    client.on('notification', (message) => {
      for (const handler of this.handlers.get(message.channel) ?? []) handler(message.payload ?? '');
    });
    try {
      await client.connect();
      for (const channel of this.handlers.keys()) await client.query(`LISTEN ${channel}`);
      this.client = client;
      for (const handler of this.reconnectHandlers) handler();
    } catch (error) {
      log('warn', 'listener_connect_failed', { error: (error as Error).message });
      this.scheduleReconnect(client);
    }
  }

  private scheduleReconnect(client: pg.Client): void {
    if (this.client === client) this.client = null;
    if (this.stopped || this.retry) return;
    client.removeAllListeners();
    client.on('error', () => undefined);
    void client.end().catch(() => undefined);
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.start();
    }, 1000);
    this.retry.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      client.on('error', () => undefined);
      await client.end().catch(() => undefined);
    }
  }
}
