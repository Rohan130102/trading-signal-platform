import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type AccessDecision, clientMessageSchema, type FeedEvent } from '@signaldesk/domain';
import { WebSocket, WebSocketServer } from 'ws';
import { bearerToken, parseCookies } from '../common/http.js';
import { log } from '../common/log.js';
import { env } from '../config/env.js';
import { AuthService } from '../auth/auth.service.js';
import { SESSION_COOKIE } from '../auth/session.guard.js';
import { CH_ACCESS, CH_EVENTS, CH_REFRESH, ListenerService } from '../db/listener.service.js';
import { PrismaService } from '../db/prisma.service.js';
import { type AlertScope, AudienceService, type Periods } from '../feed/audience.service.js';
import { toFeedEvent } from '../trades/mappers.js';

const RING_SIZE = 2000;
const PAGE = 200;
const POLL_MS = 3000;
const REVALIDATE_MS = 30_000;
const SWEEP_MS = 5000;
const PING_MS = 25_000;
const MAX_BUFFERED_BYTES = 2_000_000;
const MAX_CONNECTIONS_PER_USER = 8;

interface Conn {
  ws: WebSocket;
  userId: string;
  sessionId: string;
  /** Null until the client says where it left off. */
  cursor: number | null;
  validUntil: number | null;
  validatedAt: number;
  alive: boolean;
  pumping: boolean;
  dirty: boolean;
  /** What this member may see; refreshed with every access check. */
  periods: Periods;
}

/** An alert, with what the audience rule needs to decide who receives it. Only `event` is ever sent. */
interface RingItem {
  event: FeedEvent;
  scope: AlertScope;
}

const WITH_SCOPE = {
  trade: { select: { status: true, publishedAt: true, removal: { select: { tradeId: true } } } },
} as const;

function toRingItem(
  row: {
    createdAt: Date;
    tradeId: string | null;
    trade: { status: string; publishedAt: Date | null; removal: { tradeId: string } | null } | null;
  } & Parameters<typeof toFeedEvent>[0],
): RingItem {
  return {
    event: toFeedEvent(row, (row.trade?.status ?? null) as Parameters<typeof toFeedEvent>[1]),
    scope: {
      createdAt: row.createdAt.toISOString(),
      tradePublishedAt: row.trade?.publishedAt?.toISOString() ?? null,
      hasTrade: row.tradeId !== null,
      removed: row.trade?.removal != null,
    },
  };
}

/**
 * Tails the committed event log, so in-app delivery keeps working even if the push worker is down.
 * Delivery is cursor-driven: each connection is simply "up to sequence N", and the same code path
 * serves first load, reconnect catch-up and live updates. Events therefore arrive in order, with no
 * gaps, and a client's own de-duplication by sequence absorbs any repeat after a reconnect.
 */
@Injectable()
export class RealtimeGateway implements OnModuleDestroy {
  private wss: WebSocketServer | null = null;
  private readonly conns = new Set<Conn>();
  private ring: RingItem[] = [];
  private head = 0;
  private tailing = false;
  private tailAgain = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly listener: ListenerService,
    private readonly audience: AudienceService,
  ) {}

  get connectionCount(): number {
    return this.conns.size;
  }

  async attach(server: Server): Promise<void> {
    const latest = await this.prisma.signalEvent.aggregate({ where: { broadcast: true }, _max: { seq: true } });
    this.head = Number(latest._max.seq ?? 0);

    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
    server.on('upgrade', (req, socket, head) => {
      void this.onUpgrade(req, socket, head).catch((error: Error) => {
        log('warn', 'ws_upgrade_failed', { error: error.message });
        this.rejectUpgrade(socket, 500);
      });
    });

    this.listener.on(CH_EVENTS, () => void this.tail());
    // Only a reason travels; each app reloads through the API, which applies the viewer's own access.
    this.listener.on(CH_REFRESH, (reason) => {
      const message = { type: 'refresh', reason: reason.slice(0, 40) };
      for (const conn of this.conns) this.send(conn, message);
    });
    this.listener.on(CH_ACCESS, (userId) => {
      this.revalidateUser(userId).catch((error: Error) =>
        log('warn', 'access_recheck_failed', { error: error.message }),
      );
    });
    this.listener.onReconnect(() => void this.tail());
    await this.listener.start();

    this.timers.push(
      setInterval(() => void this.tail(), POLL_MS),
      setInterval(() => void this.sweepAccess(), SWEEP_MS),
      setInterval(() => this.heartbeat(), PING_MS),
    );
    for (const timer of this.timers) timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    for (const conn of this.conns) conn.ws.close(1001, 'Server restarting');
    this.wss?.close();
  }

  private rejectUpgrade(socket: Duplex, status: number): void {
    socket.write(
      `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  }

  private async onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname !== '/ws') return this.rejectUpgrade(socket, 404);
    // Browsers attach cookies to cross-site WebSockets, so a cookie needs an allowed Origin. A browser
    // page cannot set this header, so a bearer token needs no such check (native apps send their own Origin).
    const bearer = bearerToken(req.headers.authorization);
    if (!bearer && (!req.headers.origin || !env.APP_ORIGINS.includes(req.headers.origin))) {
      return this.rejectUpgrade(socket, 403);
    }
    const token = bearer ?? parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const context = token ? await this.auth.authenticate(token) : null;
    if (!context || context.next) return this.rejectUpgrade(socket, 401);
    const periods = await this.audience.periods(context.user.id);

    const wss = this.wss as WebSocketServer;
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!context.access.allowed) {
        ws.send(JSON.stringify({ type: 'denied', reason: context.access.reason }));
        ws.close(4403, 'No access');
        return;
      }
      const existing = [...this.conns].filter((c) => c.userId === context.user.id);
      if (existing.length >= MAX_CONNECTIONS_PER_USER) existing[0]?.ws.close(4408, 'Too many connections');

      const conn: Conn = {
        ws,
        userId: context.user.id,
        sessionId: context.sessionId,
        cursor: null,
        validUntil: context.access.validUntil?.getTime() ?? null,
        validatedAt: Date.now(),
        alive: true,
        pumping: false,
        dirty: false,
        periods,
      };
      this.conns.add(conn);
      ws.on('pong', () => {
        conn.alive = true;
      });
      ws.on('close', () => this.conns.delete(conn));
      ws.on('error', () => this.conns.delete(conn));
      ws.on('message', (data) => this.onMessage(conn, data.toString()));
    });
  }

  private onMessage(conn: Conn, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      conn.ws.close(4400, 'Bad message');
      return;
    }
    const message = clientMessageSchema.safeParse(parsed);
    if (!message.success) {
      conn.ws.close(4400, 'Bad message');
      return;
    }
    if (message.data.type === 'ping') {
      this.send(conn, { type: 'pong' });
      return;
    }
    // A claimed position beyond the head can only be stale or bogus, so it is clamped.
    conn.cursor = Math.min(message.data.lastSeq, this.head);
    this.send(conn, { type: 'ready', headSeq: this.head });
    this.advance(conn);
  }

  /** Never throws. If the database is away, this connection stays behind and the next tail retries it. */
  private advance(conn: Conn): Promise<void> {
    return this.pump(conn).catch((error: Error) => log('warn', 'pump_failed', { error: error.message }));
  }

  private send(conn: Conn, message: unknown): void {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(message));
  }

  /** Loads newly committed events, then advances every connection. Single flight per instance. */
  private async tail(): Promise<void> {
    if (this.tailing) {
      this.tailAgain = true;
      return;
    }
    this.tailing = true;
    try {
      do {
        this.tailAgain = false;
        const rows = await this.prisma.signalEvent.findMany({
          where: { broadcast: true, seq: { gt: BigInt(this.head) } },
          orderBy: { seq: 'asc' },
          take: PAGE,
          include: WITH_SCOPE,
        });
        const fresh = rows.map(toRingItem);
        if (fresh.length > 0) {
          this.ring.push(...fresh);
          if (this.ring.length > RING_SIZE) this.ring = this.ring.slice(-RING_SIZE);
          this.head = fresh[fresh.length - 1]?.event.seq ?? this.head;
        }
        // Also picks up any connection left behind by an earlier failure.
        const lagging = [...this.conns].filter((c) => c.cursor !== null && c.cursor < this.head);
        await Promise.all(lagging.map((c) => this.advance(c)));
        if (fresh.length > 0) await this.recordFanout(fresh.map((item) => item.event));
        if (rows.length === PAGE) this.tailAgain = true;
      } while (this.tailAgain);
    } catch (error) {
      log('warn', 'tail_failed', { error: (error as Error).message });
    } finally {
      this.tailing = false;
    }
  }

  private async recordFanout(events: FeedEvent[]): Promise<void> {
    const now = Date.now();
    const recipients = [...this.conns].filter((c) => c.cursor !== null && c.ws.readyState === WebSocket.OPEN).length;
    await this.prisma.fanoutMetric
      .createMany({
        data: events.map((e) => ({
          eventId: e.id,
          instanceId: env.INSTANCE_ID,
          recipients,
          latencyMs: Math.max(0, now - new Date(e.createdAt).getTime()),
        })),
        skipDuplicates: true,
      })
      .catch((error: Error) => log('warn', 'fanout_metric_failed', { error: error.message }));
  }

  private async eventsAfter(cursor: number): Promise<RingItem[]> {
    const first = this.ring[0];
    if (first && cursor >= first.event.seq - 1) {
      return this.ring.filter((item) => item.event.seq > cursor).slice(0, PAGE);
    }
    if (cursor >= this.head) return [];
    const rows = await this.prisma.signalEvent.findMany({
      where: { broadcast: true, seq: { gt: BigInt(cursor), lte: BigInt(this.head) } },
      orderBy: { seq: 'asc' },
      take: PAGE,
      include: WITH_SCOPE,
    });
    return rows.map(toRingItem);
  }

  private async pump(conn: Conn): Promise<void> {
    if (conn.cursor === null) return;
    if (conn.pumping) {
      conn.dirty = true;
      return;
    }
    conn.pumping = true;
    try {
      do {
        conn.dirty = false;
        if (conn.ws.readyState !== WebSocket.OPEN) return;
        if (!(await this.stillAllowed(conn))) return;
        const items = await this.eventsAfter(conn.cursor);
        for (const { event, scope } of items) {
          if (conn.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
            // A client this far behind recovers faster by reconnecting from its cursor.
            conn.ws.terminate();
            return;
          }
          // Skipped alerts still move the cursor: the member simply never had them.
          if (AudienceService.alertVisible(scope, conn.periods)) this.send(conn, { type: 'event', event });
          conn.cursor = event.seq;
        }
        if (items.length === PAGE) conn.dirty = true;
      } while (conn.dirty);
    } finally {
      conn.pumping = false;
    }
  }

  private async stillAllowed(conn: Conn): Promise<boolean> {
    const now = Date.now();
    if ((conn.validUntil === null || now < conn.validUntil) && now - conn.validatedAt < REVALIDATE_MS) return true;
    const [decisions, scopes] = await Promise.all([
      this.auth.decisionsForSessions([conn.sessionId]),
      this.audience.periodsFor([conn.userId]),
    ]);
    const allowed = this.applyDecision(conn, decisions.get(conn.sessionId) ?? null);
    if (allowed) conn.periods = scopes.get(conn.userId) ?? [];
    return allowed;
  }

  private applyDecision(conn: Conn, decision: AccessDecision | null): boolean {
    if (!decision) {
      this.send(conn, { type: 'denied', reason: 'SESSION_ENDED' });
      conn.ws.close(4401, 'Session ended');
      return false;
    }
    if (!decision.allowed) {
      this.send(conn, { type: 'denied', reason: decision.reason });
      conn.ws.close(4403, 'No access');
      return false;
    }
    conn.validUntil = decision.validUntil?.getTime() ?? null;
    conn.validatedAt = Date.now();
    return true;
  }

  private async revalidateUser(userId: string): Promise<void> {
    const targets = [...this.conns].filter((c) => c.userId === userId);
    if (targets.length === 0) return;
    await this.revalidate(targets);
  }

  private async revalidate(targets: Conn[]): Promise<void> {
    const [decisions, scopes] = await Promise.all([
      this.auth.decisionsForSessions([...new Set(targets.map((c) => c.sessionId))]),
      this.audience.periodsFor([...new Set(targets.map((c) => c.userId))]),
    ]);
    for (const conn of targets) {
      if (this.applyDecision(conn, decisions.get(conn.sessionId) ?? null)) conn.periods = scopes.get(conn.userId) ?? [];
    }
  }

  /** Closes connections that passed their expiry or are due a re-check, in one query. */
  private async sweepAccess(): Promise<void> {
    const now = Date.now();
    const due = [...this.conns].filter(
      (c) => (c.validUntil !== null && now >= c.validUntil) || now - c.validatedAt >= REVALIDATE_MS,
    );
    if (due.length === 0) return;
    await this.revalidate(due).catch((error: Error) => log('warn', 'access_sweep_failed', { error: error.message }));
  }

  private heartbeat(): void {
    for (const conn of this.conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        this.conns.delete(conn);
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }
}
