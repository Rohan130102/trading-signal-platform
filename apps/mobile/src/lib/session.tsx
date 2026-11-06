import type { MeResponse, TokenLoginResponse } from '@signaldesk/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Device from 'expo-device';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api, ApiError, setApiToken, setSessionEndedHandler } from './api';
import { unregisterThisDevice } from './push';
import type { SessionPhase } from './routing';
import { secure } from './storage';

interface SessionValue {
  state: SessionPhase;
  me: MeResponse | null;
  /** Why someone was returned to the sign-in screen, when it was not their choice. */
  notice: string | null;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** The signed-in account, for screens that only render once there is one. */
export function useMe(): MeResponse {
  const { me } = useSession();
  if (!me) throw new Error('useMe needs a signed-in session');
  return me;
}

function deviceLabel(): string {
  const os = Platform.OS === 'ios' ? 'iOS' : 'Android';
  return [Device.modelName, `${os} ${Device.osVersion ?? ''}`.trim()].filter(Boolean).join(', ').slice(0, 120);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [booted, setBooted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clearing = useRef(false);

  const clearLocal = useCallback(async () => {
    setApiToken(null);
    setToken(null);
    client.clear();
    await secure.clearSession();
  }, [client]);

  useEffect(() => {
    let active = true;
    void secure.getToken().then((saved) => {
      if (!active) return;
      setApiToken(saved);
      setToken(saved);
      setBooted(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSessionEndedHandler(() => {
      if (clearing.current) return;
      clearing.current = true;
      setNotice('Your session ended. Please sign in again.');
      void clearLocal().finally(() => {
        clearing.current = false;
      });
    });
    return () => setSessionEndedHandler(null);
  }, [clearLocal]);

  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me', token],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    enabled: Boolean(token),
    retry: (count, error) => error.isNetwork && count < 2,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const signIn = useCallback(async (identifier: string, password: string) => {
    const session = await api.post<TokenLoginResponse>('/auth/token', {
      identifier,
      password,
      deviceLabel: deviceLabel(),
    });
    setApiToken(session.token);
    await secure.setToken(session.token);
    setNotice(null);
    setToken(session.token);
  }, []);

  const signOut = useCallback(async () => {
    setNotice(null);
    await unregisterThisDevice();
    await api.post('/auth/logout').catch(() => undefined);
    await clearLocal();
  }, [clearLocal]);

  const refresh = useCallback(async () => {
    await client.invalidateQueries({ queryKey: ['me'] });
  }, [client]);

  const state: SessionPhase = useMemo(() => {
    if (!booted) return { phase: 'starting' };
    if (!token) return { phase: 'signed-out' };
    if (meQuery.data) return { phase: 'signed-in', me: meQuery.data };
    if (meQuery.isError) return { phase: 'unreachable' };
    return { phase: 'loading' };
  }, [booted, meQuery.data, meQuery.isError, token]);

  const value = useMemo<SessionValue>(
    () => ({
      state,
      me: meQuery.data ?? null,
      notice,
      signIn,
      signOut,
      refresh,
      retry: () => void meQuery.refetch(),
    }),
    [meQuery, notice, refresh, signIn, signOut, state],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
