'use client';

import type { FeedEvent, FeedPage } from '@signaldesk/domain';
import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from './api';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface RealtimeValue {
  state: ConnectionState;
  /** Called once the initial feed has loaded, so catch-up starts from what is on screen. */
  /** True if this call began the connection, false if it was already running. */
  start: (fromSeq: number) => boolean;
  unread: number;
  setUnread: (value: number) => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function useRealtime(): RealtimeValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime must be used inside RealtimeProvider');
  return value;
}

function socketUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
}

function mergeIntoFeed(data: InfiniteData<FeedPage> | undefined, event: FeedEvent) {
  if (!data) return data;
  const first = data.pages[0];
  if (!first) return data;
  if (data.pages.some((p) => p.events.some((e) => e.seq === event.seq))) return data;
  return {
    ...data,
    pages: [
      { ...first, events: [event, ...first.events], headSeq: Math.max(first.headSeq, event.seq) },
      ...data.pages.slice(1),
    ],
  };
}

interface Callbacks {
  onState: (state: ConnectionState) => void;
  onEvent: (event: FeedEvent) => void;
  /** The server ended this connection because access changed. */
  onAccessChanged: () => void;
}

const PING_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * One socket per tab. Position is a sequence number: after any disconnect the client states the last
 * event it holds and the server replays from there, so nothing is lost or repeated. The feed API stays
 * authoritative; this only keeps it current without refreshing.
 */
class LiveConnection {
  private socket: WebSocket | null = null;
  private lastSeq: number | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongDeadline: number | null = null;
  private stopped = false;
  private ready = false;

  constructor(private readonly callbacks: Callbacks) {}

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

  /** Called when the browser says it is back: try now rather than waiting out the backoff. */
  wake(): void {
    if (this.stopped || this.lastSeq === null) return;
    this.attempts = 0;
    if (this.socket?.readyState === WebSocket.OPEN) {
      // The socket may have survived, or it may be silently dead. A ping settles which.
      this.callbacks.onState(this.ready ? 'live' : 'connecting');
      this.ping();
      return;
    }
    this.connect();
  }

  markOffline(): void {
    this.callbacks.onState('offline');
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private ping(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    this.pongDeadline ??= Date.now() + PONG_TIMEOUT_MS;
    socket.send(JSON.stringify({ type: 'ping' }));
  }

  private connect(): void {
    if (this.stopped || this.lastSeq === null) return;
    const current = this.socket?.readyState;
    if (current === WebSocket.OPEN || current === WebSocket.CONNECTING) return;
    this.clearTimers();
    this.ready = false;
    const socket = new WebSocket(socketUrl());
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
      const data = JSON.parse(message.data as string) as { type: string; event?: FeedEvent };
      if (data.type === 'event' && data.event) {
        if (this.lastSeq !== null && data.event.seq <= this.lastSeq) return;
        this.lastSeq = data.event.seq;
        this.callbacks.onEvent(data.event);
      } else if (data.type === 'pong') {
        this.pongDeadline = null;
      } else if (data.type === 'ready') {
        this.attempts = 0;
        this.ready = true;
        this.callbacks.onState('live');
      }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (event.code === 4401 || event.code === 4403) {
        this.stopped = true;
        this.clearTimers();
        this.callbacks.onAccessChanged();
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.clearTimers();
    this.callbacks.onState(navigator.onLine === false ? 'offline' : 'reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts) * (0.5 + Math.random() / 2);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}

function afterAccessChanged(client: QueryClient): void {
  // Whatever private data is held in memory goes now, not whenever the next screen loads.
  for (const key of ['feed', 'active', 'history', 'trade', 'symbols']) client.removeQueries({ queryKey: [key] });
  void client.invalidateQueries({ queryKey: ['me'] });
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  const [unread, setUnread] = useState(0);
  const connection = useRef<LiveConnection | null>(null);

  useEffect(() => {
    const live = new LiveConnection({
      onState: setState,
      onAccessChanged: () => afterAccessChanged(client),
      onEvent: (event) => {
        client.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ['feed'] }, (data) => mergeIntoFeed(data, event));
        setUnread((n) => n + 1);
        if (event.tradeId) void client.invalidateQueries({ queryKey: ['trade', event.tradeId] });
        void client.invalidateQueries({ queryKey: ['active'] });
        void client.invalidateQueries({ queryKey: ['history'] });
        void client.invalidateQueries({ queryKey: ['admin'] });
        if (event.priority === 'PRIORITY' && document.visibilityState === 'visible') {
          toast.warning(event.title, { description: event.body.split('\n')[0], duration: 10_000 });
        }
      },
    });
    connection.current = live;
    const wake = () => live.wake();
    const offline = () => live.markOffline();
    const visible = () => {
      if (document.visibilityState === 'visible') live.wake();
    };
    window.addEventListener('online', wake);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
      live.stop();
      connection.current = null;
    };
  }, [client]);

  const start = useCallback((fromSeq: number) => connection.current?.start(fromSeq) ?? false, []);
  const value = useMemo<RealtimeValue>(() => ({ state, start, unread, setUnread }), [start, state, unread]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** For screens outside the feed: fetches the current head once so live updates begin anyway. */
export function useStartRealtimeFromHead(enabled: boolean) {
  const { start, setUnread } = useRealtime();
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    void api
      .get<FeedPage>('/feed?limit=1')
      .then((page) => {
        // Arriving on another screen first: the badge should reflect what was missed while away.
        if (start(page.headSeq)) setUnread(page.unread);
      })
      .catch(() => {
        started.current = false;
      });
  }, [enabled, setUnread, start]);
}
