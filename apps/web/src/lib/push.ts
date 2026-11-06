'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

export type PushState =
  | 'loading'
  /** The server has no push configured. */
  | 'unavailable'
  /** This browser has no Web Push at all. */
  | 'unsupported'
  /** iPhone or iPad in a browser tab: needs Add to Home Screen first. */
  | 'ios-needs-install'
  | 'ready'
  | 'denied'
  | 'on';

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua)
    ? 'iPhone/iPad'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return `${browser} on ${os}`;
}

interface PushConfig {
  available: boolean;
  publicKey: string | null;
}

export function usePush() {
  const [state, setState] = useState<PushState>('loading');
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
      setState(isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported');
      return;
    }
    if (isIos() && !isStandalone()) {
      setState('ios-needs-install');
      return;
    }
    const cfg = await api.get<PushConfig>('/push/config');
    setConfig(cfg);
    if (!cfg.available || !cfg.publicKey) {
      setState('unavailable');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    setState(subscription && Notification.permission === 'granted' ? 'on' : 'ready');
  }, []);

  useEffect(() => {
    void refresh().catch(() => setState('unsupported'));
  }, [refresh]);

  /** Must run from a click: browsers penalise permission prompts that appear unprompted. */
  const enable = useCallback(async () => {
    if (!config?.publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'ready');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(config.publicKey),
        }));
      const json = subscription.toJSON();
      await api.post('/push/subscriptions', {
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        deviceLabel: deviceLabel(),
      });
      setState('on');
    } finally {
      setBusy(false);
    }
  }, [config]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api.delete('/push/subscriptions', { endpoint: subscription.endpoint }).catch((e: ApiError) => {
          if (!e.isNetwork) throw e;
        });
        await subscription.unsubscribe();
      }
      setState('ready');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, enable, disable, refresh };
}

/** The offline page and app shell behaviour need the worker even before notifications are enabled. */
export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
