import type { MeResponse, TokenLoginResponse } from '@signaldesk/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Device from 'expo-device';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api, ApiError, setApiToken, setSessionEndedHandler } from './api';
import { installationId } from './installation';
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
  /** Keeps the current screen, whatever the session says next. See the recovery codes screen. */
  holdRoute: boolean;
  setHoldRoute: (hold: boolean) => void;
  /**
   * The password just typed at sign-in. On a first sign-in it is the temporary password, and asking
   * for it again a moment later would only be an obstacle. Held in memory, never stored, and dropped as
   * soon as that step is over.
   */
  signInPassword: () => string | null;
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
  const [holdRoute, setHoldRoute] = useState(false);
  const clearing = useRef(false);
  const typedPassword = useRef<string | null>(null);

  const clearLocal = useCallback(async () => {
    typedPassword.current = null;
    setHoldRoute(false);
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

  const {
    data: me,
    isError: meFailed,
    refetch: refetchMe,
  } = useQuery<MeResponse, ApiError>({
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
      // Binds this phone to one subscriber on the server. Kept across sign-outs and reinstalls.
      installationId: await installationId(),
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    typedPassword.current = password;
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
    if (me) return { phase: 'signed-in', me };
    if (meFailed) return { phase: 'unreachable' };
    return { phase: 'loading' };
  }, [booted, me, meFailed, token]);

  useEffect(() => {
    // Only a required password change needs it. Otherwise it goes as soon as that is known.
    if (me && me.next !== 'CHANGE_PASSWORD') typedPassword.current = null;
  }, [me]);

  const value = useMemo<SessionValue>(
    () => ({
      state,
      me: me ?? null,
      notice,
      signIn,
      signOut,
      refresh,
      retry: () => void refetchMe(),
      holdRoute,
      setHoldRoute,
      signInPassword: () => typedPassword.current,
    }),
    [holdRoute, me, notice, refetchMe, refresh, signIn, signOut, state],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
