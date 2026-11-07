import {
  type ConnectionState,
  type FeedEvent,
  type FeedPage,
  LiveConnection,
  type LiveSocket,
} from '@signaldesk/domain';
import NetInfo from '@react-native-community/netinfo';
import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api, getApiToken } from './api';
import { API, socketUrl } from './config';
import { setLiveConnected } from './push';

/** React Native's WebSocket takes headers as a third argument. Browsers have no equivalent. */
const NativeWebSocket = WebSocket as unknown as new (
  url: string,
  protocols: undefined,
  options: { headers: Record<string, string> },
) => LiveSocket;

interface RealtimeValue {
  state: ConnectionState;
  /** Called once the feed has loaded, so catch-up starts from what is on screen. */
  start: (fromSeq: number) => boolean;
  unread: number;
  setUnread: (value: number) => void;
  /** The newest event seen live, for the in-app alert. */
  latest: FeedEvent | null;
  clearLatest: () => void;
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

function afterAccessChanged(client: QueryClient): void {
  // Whatever private data is held in memory goes now, not whenever the next screen loads.
  for (const key of ['feed', 'active', 'history', 'trade', 'symbols']) client.removeQueries({ queryKey: [key] });
  void client.invalidateQueries({ queryKey: ['me'] });
}

export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<FeedEvent | null>(null);
  const connection = useRef<LiveConnection | null>(null);
  const lastBuzz = useRef(0);

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
      onState: (next) => {
        setState(next);
        setLiveConnected(next === 'live');
      },
      onAccessChanged: () => afterAccessChanged(client),
      onEvent: (event) => {
        client.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ['feed'] }, (data) => mergeIntoFeed(data, event));
        setUnread((n) => n + 1);
        setLatest(event);
        if (event.tradeId) {
          void client.invalidateQueries({ queryKey: ['trade', event.tradeId] });
          void client.invalidateQueries({ queryKey: ['admin', 'trade', event.tradeId] });
        }
        void client.invalidateQueries({ queryKey: ['active'] });
        void client.invalidateQueries({ queryKey: ['history'] });
        void client.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
        void client.invalidateQueries({ queryKey: ['admin', 'trades'] });
        // A burst of catch-up events after reconnecting should not buzz repeatedly.
        const now = Date.now();
        if (now - lastBuzz.current > 2000) {
          lastBuzz.current = now;
          void Haptics.notificationAsync(
            event.priority === 'PRIORITY'
              ? Haptics.NotificationFeedbackType.Warning
              : Haptics.NotificationFeedbackType.Success,
          ).catch(() => undefined);
        }
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
      setLiveConnected(false);
      setState('connecting');
      setUnread(0);
      setLatest(null);
    };
  }, [client, enabled]);

  const start = useCallback((fromSeq: number) => connection.current?.start(fromSeq) ?? false, []);
  const clearLatest = useCallback(() => setLatest(null), []);
  const value = useMemo<RealtimeValue>(
    () => ({ state, start, unread, setUnread, latest, clearLatest }),
    [clearLatest, latest, start, state, unread],
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
