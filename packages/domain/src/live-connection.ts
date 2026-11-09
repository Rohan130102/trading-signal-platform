import type { FeedEvent } from './dto.js';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** The part of a WebSocket this needs, so browsers and React Native can each supply their own. */
export interface LiveSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: SocketHandler<never>;
  onmessage: SocketHandler<{ data: unknown }>;
  onclose: SocketHandler<{ code?: number }>;
  onerror?: SocketHandler<never>;
}

/** Written as a method so that each platform's richer event types are accepted. */
type SocketHandler<E> = { handle(event: E): unknown }['handle'] | null;

export interface LiveConnectionOptions {
  createSocket: () => LiveSocket;
  /** Whether the platform knows it is offline. */
  isOffline?: () => boolean;
  onState: (state: ConnectionState) => void;
  onEvent: (event: FeedEvent) => void;
  /** The server ended this connection because access changed. */
  onAccessChanged: () => void;
  /** Lists changed without a new event (a trade was removed, a rule changed): reload them. */
  onRefresh?: (reason: string) => void;
}

const CONNECTING = 0;
const OPEN = 1;
const PING_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * One socket per client. Position is a sequence number: after any disconnect the client states the
 * last event it holds and the server replays from there, so nothing is lost or repeated. The feed API
 * stays authoritative; this only keeps it current without refreshing.
 */
export class LiveConnection {
  private socket: LiveSocket | null = null;
  private lastSeq: number | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongDeadline: number | null = null;
  private stopped = false;
  private ready = false;

  constructor(private readonly options: LiveConnectionOptions) {}

  /** True if this call began the connection, false if it was already running. */
  start(fromSeq: number): boolean {
    if (this.lastSeq !== null) return false;
    this.lastSeq = fromSeq;
    this.connect();
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  /** Called when the device says it is back: try now rather than waiting out the backoff. */
  wake(): void {
    if (this.stopped || this.lastSeq === null) return;
    this.attempts = 0;
    if (this.socket?.readyState === OPEN) {
      // The socket may have survived, or it may be silently dead. A ping settles which.
      this.options.onState(this.ready ? 'live' : 'connecting');
      this.ping();
      return;
    }
    this.connect();
  }

  markOffline(): void {
    this.options.onState('offline');
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private ping(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    this.pongDeadline ??= Date.now() + PONG_TIMEOUT_MS;
    socket.send(JSON.stringify({ type: 'ping' }));
  }

  private connect(): void {
    if (this.stopped || this.lastSeq === null) return;
    const current = this.socket?.readyState;
    if (current === OPEN || current === CONNECTING) return;
    this.clearTimers();
    this.ready = false;
    const socket = this.options.createSocket();
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'hello', lastSeq: this.lastSeq ?? 0 }));
      this.pongDeadline = null;
      // Mobile networks can leave a socket dead with no close event, so this checks both ways.
      this.pingTimer = setInterval(() => {
        if (this.pongDeadline && Date.now() > this.pongDeadline) {
          socket.close();
          return;
        }
        this.ping();
      }, PING_MS);
    };
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data as string) as { type: string; event?: FeedEvent; reason?: string };
      if (data.type === 'event' && data.event) {
        if (this.lastSeq !== null && data.event.seq <= this.lastSeq) return;
        this.lastSeq = data.event.seq;
        this.options.onEvent(data.event);
      } else if (data.type === 'pong') {
        this.pongDeadline = null;
      } else if (data.type === 'ready') {
        this.attempts = 0;
        this.ready = true;
        this.options.onState('live');
      } else if (data.type === 'refresh') {
        this.options.onRefresh?.(data.reason ?? '');
      }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (event.code === 4401 || event.code === 4403) {
        this.stopped = true;
        this.clearTimers();
        this.options.onAccessChanged();
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.clearTimers();
    this.options.onState(this.options.isOffline?.() ? 'offline' : 'reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts) * (0.5 + Math.random() / 2);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}
