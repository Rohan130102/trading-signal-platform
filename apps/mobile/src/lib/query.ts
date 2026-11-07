import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { ApiError } from './api';

/** Refetch when the app returns to the foreground, and pause while the phone has no network. */
export function connectQueryToDevice(): () => void {
  const appState = AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((net) => setOnline(net.isConnected !== false)),
  );
  return () => appState.remove();
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) => error instanceof ApiError && (error.isNetwork || error.status >= 500) && count < 2,
        staleTime: 10_000,
      },
    },
  });
}
