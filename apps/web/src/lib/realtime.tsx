'use client';

import { type ConnectionState, type FeedEvent, type FeedPage, LiveConnection } from '@signaldesk/domain';
import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from './api';

export type { ConnectionState };

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
      createSocket: () => new WebSocket(socketUrl()),
      isOffline: () => navigator.onLine === false,
      onState: setState,
      onAccessChanged: () => afterAccessChanged(client),
      // A trade was removed from subscriber screens or a rule changed: everything shown is read again.
      onRefresh: () => void client.invalidateQueries(),
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
