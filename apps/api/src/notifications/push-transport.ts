import { Injectable } from '@nestjs/common';
import webpush, { WebPushError } from 'web-push';
import { log } from '../common/log.js';
import { env } from '../config/env.js';

export type PushTarget =
  { channel: 'WEB_PUSH'; endpoint: string; p256dh: string; auth: string } | { channel: 'EXPO'; endpoint: string };

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it should lead in the web app. */
  url: string;
  /** Where tapping it should lead in the native app. */
  path: string;
  /** Devices collapse notifications with the same tag, so an accidental resend does not stack. */
  tag: string;
  urgent: boolean;
  androidChannel: string;
}

export type PushResult =
  /** A receipt means the service may still report a failure later. */
  | { kind: 'ACCEPTED'; statusCode: number; receiptId?: string }
  /** The push service says this device is gone. Do not try it again. */
  | { kind: 'GONE'; statusCode: number; error: string }
  | { kind: 'RETRY'; statusCode: number | null; error: string }
  | { kind: 'FAILED'; statusCode: number | null; error: string };

export type ExpoReceipt = { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

/** The time a push stays useful. A trading instruction hours late does more harm than none. */
export const PUSH_TTL_SECONDS = 3600;

const EXPO_RETRYABLE = new Set(['MessageRateExceeded']);

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Boundary to the outside world, so SMS or another channel can be added beside these later. */
@Injectable()
export class PushTransport {
  constructor() {
    if (env.PUSH_TRANSPORT === 'webpush') {
      webpush.setVapidDetails(
        env.VAPID_SUBJECT as string,
        env.VAPID_PUBLIC_KEY as string,
        env.VAPID_PRIVATE_KEY as string,
      );
    }
  }

  get mode() {
    return env.PUSH_TRANSPORT;
  }

  get webAvailable(): boolean {
    return env.PUSH_TRANSPORT !== 'disabled';
  }

  get nativeAvailable(): boolean {
    return env.EXPO_PUSH_ENABLED;
  }

  get available(): boolean {
    return this.webAvailable || this.nativeAvailable;
  }

  get publicKey(): string | null {
    return env.PUSH_TRANSPORT === 'webpush' ? (env.VAPID_PUBLIC_KEY as string) : null;
  }

  isAllowedEndpoint(endpoint: string): boolean {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return false;
    }
    if (url.protocol !== 'https:') return false;
    return env.PUSH_ENDPOINT_ALLOWLIST.some((pattern) =>
      pattern.startsWith('*.') ? url.hostname.endsWith(pattern.slice(1)) : url.hostname === pattern,
    );
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    return target.channel === 'EXPO' ? this.sendExpo(target.endpoint, message) : this.sendWeb(target, message);
  }

  private async sendWeb(
    target: Extract<PushTarget, { channel: 'WEB_PUSH' }>,
    message: PushMessage,
  ): Promise<PushResult> {
    if (env.PUSH_TRANSPORT === 'disabled') {
      return { kind: 'FAILED', statusCode: null, error: 'Push is not configured' };
    }
    if (env.PUSH_TRANSPORT === 'log') {
      log('info', 'push_log_transport', { tag: message.tag, urgent: message.urgent });
      return { kind: 'ACCEPTED', statusCode: 201 };
    }
    try {
      const response = await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        { TTL: PUSH_TTL_SECONDS, urgency: message.urgent ? 'high' : 'normal', timeout: 10_000, topic: undefined },
      );
      return { kind: 'ACCEPTED', statusCode: response.statusCode };
    } catch (error) {
      if (error instanceof WebPushError) {
        const code = error.statusCode;
        if (code === 404 || code === 410)
          return { kind: 'GONE', statusCode: code, error: 'Subscription no longer exists' };
        if (code === 429 || code >= 500)
          return { kind: 'RETRY', statusCode: code, error: `Push service responded ${code}` };
        return { kind: 'FAILED', statusCode: code, error: `Push service rejected the request (${code})` };
      }
      return { kind: 'RETRY', statusCode: null, error: `Network error: ${(error as Error).message}`.slice(0, 200) };
    }
  }

  private expoHeaders(): Record<string, string> {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
    };
  }

  private async sendExpo(token: string, message: PushMessage): Promise<PushResult> {
    if (!env.EXPO_PUSH_ENABLED) {
      return { kind: 'FAILED', statusCode: null, error: 'Native push is not configured' };
    }
    let response: Response;
    try {
      response = await fetch(`${env.EXPO_PUSH_API_URL}/send`, {
        method: 'POST',
        headers: this.expoHeaders(),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify([
          {
            to: token,
            title: message.title,
            body: message.body,
            sound: 'default',
            priority: message.urgent ? 'high' : 'normal',
            channelId: message.androidChannel,
            ttl: PUSH_TTL_SECONDS,
            data: { path: message.path, eventId: message.tag },
          },
        ]),
      });
    } catch (error) {
      return { kind: 'RETRY', statusCode: null, error: `Network error: ${(error as Error).message}`.slice(0, 200) };
    }
    if (response.status === 429 || response.status >= 500) {
      return { kind: 'RETRY', statusCode: response.status, error: `Expo responded ${response.status}` };
    }
    if (!response.ok) {
      return { kind: 'FAILED', statusCode: response.status, error: `Expo rejected the request (${response.status})` };
    }
    const payload = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
    const ticket = payload?.data?.[0];
    if (!ticket) return { kind: 'RETRY', statusCode: response.status, error: 'Expo returned no ticket' };
    if (ticket.status === 'ok') return { kind: 'ACCEPTED', statusCode: response.status, receiptId: ticket.id };
    const code = ticket.details?.error ?? 'Unknown';
    if (code === 'DeviceNotRegistered') {
      return { kind: 'GONE', statusCode: response.status, error: 'Device is no longer registered' };
    }
    if (EXPO_RETRYABLE.has(code)) return { kind: 'RETRY', statusCode: response.status, error: `Expo: ${code}` };
    return { kind: 'FAILED', statusCode: response.status, error: `Expo: ${code}` };
  }

  /** Absent ids are not known yet, or have expired after a day. */
  async fetchExpoReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
    const response = await fetch(`${env.EXPO_PUSH_API_URL}/getReceipts`, {
      method: 'POST',
      headers: this.expoHeaders(),
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error(`Expo receipts responded ${response.status}`);
    const payload = (await response.json()) as { data?: Record<string, ExpoReceipt> };
    return payload.data ?? {};
  }
}
