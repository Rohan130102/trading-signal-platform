import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from './Toast';

/**
 * For a screen opened as a native modal. On iPhone it sits outside the app's root view, so the providers
 * there cannot reach it: without its own, it gets no safe-area insets, which puts its top bar under the
 * status bar, and any toast it shows stays hidden behind it.
 */
export function ModalFrame({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <ToastProvider>{children}</ToastProvider>
    </SafeAreaProvider>
  );
}
