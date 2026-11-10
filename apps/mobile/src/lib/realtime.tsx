import {
  type ConnectionState,
  type FeedEvent,
  type FeedPage,
  LiveConnection,
  type LiveSocket,
} from '@signaldesk/domain';
import NetInfo from '@react-native-community/netinfo';
import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api, getApiToken } from './api';
import { API, socketUrl } from './config';
import { haptics } from './haptics';
import { type PushArrival, setAppBadge } from './push';

/** React Native's WebSocket takes headers as a third argument. Browsers have no equivalent. */
const NativeWebSocket = WebSocket as unknown as new (
  url: string,
  protocols: undefined,
  options: { headers: Record<string, string> },
) => LiveSocket;

/** What the in-app banner shows, whichever way the event arrived. */
export interface LiveAlert {
  eventId: string;
  title: string;
  body: string;
  tradeId: string | null;
  category: string | null;
  priority: 'NORMAL' | 'PRIORITY';
  direction: 'BUY' | 'SELL' | null;
}

interface RealtimeValue {
  state: ConnectionState;
  /** Called once the first list has loaded, so catch-up starts from what is on screen. */
  start: (fromSeq: number) => boolean;
  unread: number;
  setUnread: (value: number) => void;
  /** The newest alert not yet shown, for the in-app banner. */
  latest: LiveAlert | null;
  clearLatest: () => void;
  /** A push that arrived while the app is open. */
  pushArrived: (arrival: PushArrival) => void;
  /** Hears every alert as it is announced (once each), for screens that mark what is new. */
  onAlert: (listener: (alert: LiveAlert) => void) => () => void;
}

/** How strongly the phone should buzz for an alert. */
export function alertWeight(alert: Pick<LiveAlert, 'category' | 'priority'>): 'signal' | 'priority' | 'update' {
  if (alert.priority === 'PRIORITY') return 'priority';
  return alert.category === 'NEW_SIGNAL' ? 'signal' : 'update';
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function useRealtime(): RealtimeValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime must be used inside RealtimeProvider');
  return value;
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

const PRIVATE_KEYS = [
  'feed',
  'signals',
  'notifications',
  'announcements',
  'active',
  'history',
  'trade',
  'symbols',
  'device',
];

function afterAccessChanged(client: QueryClient): void {
  // Whatever private data is held in memory goes now, not whenever the next screen loads.
  for (const key of PRIVATE_KEYS) client.removeQueries({ queryKey: [key] });
  void client.invalidateQueries({ queryKey: ['me'] });
}

/** Remembers which events were already announced, so a push and the live stream never alert twice. */
class SeenEvents {
  private readonly ids = new Map<string, number>();
  has(id: string): boolean {
    return this.ids.has(id);
  }
  add(id: string): void {
    this.ids.set(id, Date.now());
    if (this.ids.size > 300) {
      const oldest = [...this.ids.entries()].sort((a, b) => a[1] - b[1]).slice(0, 100);
      for (const [key] of oldest) this.ids.delete(key);
    }
  }
}

export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<LiveAlert | null>(null);
  const connection = useRef<LiveConnection | null>(null);
  const seen = useRef(new SeenEvents());
  const lastBuzz = useRef(0);
  const listeners = useRef(new Set<(alert: LiveAlert) => void>());

  const refreshLists = useCallback(
    (tradeId: string | null) => {
      if (tradeId) {
        void client.invalidateQueries({ queryKey: ['trade', tradeId] });
        void client.invalidateQueries({ queryKey: ['admin', 'trade', tradeId] });
      }
      for (const key of ['signals', 'notifications', 'announcements', 'active', 'history']) {
        void client.invalidateQueries({ queryKey: [key] });
      }
      void client.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      void client.invalidateQueries({ queryKey: ['admin', 'trades'] });
      void client.invalidateQueries({ queryKey: ['admin', 'announcements'] });
    },
    [client],
  );

  /**
   * One banner and one buzz per event, on every screen, Signals included. A burst of catch-up events
   * buzzes once, unless a new signal or a priority alert follows an ordinary update.
   */
  const lastWeight = useRef<ReturnType<typeof alertWeight>>('update');
  const announce = useCallback((alert: LiveAlert) => {
    if (seen.current.has(alert.eventId)) return;
    seen.current.add(alert.eventId);
    setLatest(alert);
    for (const listener of listeners.current) listener(alert);
    const now = Date.now();
    const weight = alertWeight(alert);
    const stronger = weight !== 'update' && lastWeight.current === 'update';
    if (now - lastBuzz.current > 2000 || stronger) {
      lastBuzz.current = now;
      lastWeight.current = weight;
      haptics.alert(weight);
    }
  }, []);

  const onAlert = useCallback((listener: (alert: LiveAlert) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !API.origin) return;
    const origin = API.origin;
    let offline = false;
    const live = new LiveConnection({
      createSocket: () =>
        new NativeWebSocket(socketUrl(origin), undefined, {
          headers: { Authorization: `Bearer ${getApiToken() ?? ''}` },
        }),
      isOffline: () => offline,
      onState: setState,
      onAccessChanged: () => afterAccessChanged(client),
      onEvent: (event) => {
        // Live events arrive exactly once and in order (see LiveConnection), so counting here is safe.
        client.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ['feed'] }, (data) => mergeIntoFeed(data, event));
        setUnread((n) => n + 1);
        refreshLists(event.tradeId);
        announce({
          eventId: event.id,
          title: event.title,
          body: event.body.split('\n')[0] ?? '',
          tradeId: event.tradeId,
          category: event.category,
          priority: event.priority,
          direction: event.category === 'NEW_SIGNAL' ? (event.payload.direction ?? null) : null,
        });
      },
    });
    connection.current = live;
    const net = NetInfo.addEventListener((info) => {
      const nowOffline = info.isConnected === false;
      if (nowOffline === offline) return;
      offline = nowOffline;
      if (offline) live.markOffline();
      else live.wake();
    });
    const appState = AppState.addEventListener('change', (status) => {
      // Sockets often die in the background without saying so. This checks, and catches up if needed.
      if (status === 'active') live.wake();
    });
    return () => {
      net();
      appState.remove();
      live.stop();
      connection.current = null;
      setState('connecting');
      setUnread(0);
      setLatest(null);
      setAppBadge(0);
    };
  }, [announce, client, enabled, refreshLists]);

  useEffect(() => {
    if (enabled) setAppBadge(unread);
  }, [enabled, unread]);

  const pushArrived = useCallback(
    (arrival: PushArrival) => {
      if (!enabled) return;
      // The banner shows straight away; the socket then catches up, and its copy of the event is
      // recognised and not announced again. Lists refetch so nothing on screen is stale.
      announce({
        eventId: arrival.eventId,
        title: arrival.title,
        body: arrival.body.split('\n')[0] ?? '',
        tradeId: arrival.tradeId,
        category: arrival.category,
        priority: arrival.priority,
        direction: arrival.direction,
      });
      connection.current?.wake();
      refreshLists(arrival.tradeId);
    },
    [announce, enabled, refreshLists],
  );

  const start = useCallback((fromSeq: number) => connection.current?.start(fromSeq) ?? false, []);
  const clearLatest = useCallback(() => setLatest(null), []);
  const value = useMemo<RealtimeValue>(
    () => ({ state, start, unread, setUnread, latest, clearLatest, pushArrived, onAlert }),
    [clearLatest, latest, onAlert, pushArrived, start, state, unread],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** For screens other than the feed: reads the current position once so live updates begin anyway. */
export function useStartRealtimeFromHead(enabled: boolean): void {
  const { start, setUnread } = useRealtime();
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    void api
      .get<FeedPage>('/feed?limit=1')
      .then((page) => {
        // Arriving somewhere else first: the badge should reflect what was missed while away.
        if (start(page.headSeq)) setUnread(page.unread);
      })
      .catch(() => {
        started.current = false;
      });
  }, [enabled, setUnread, start]);
}
