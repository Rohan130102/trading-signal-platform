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
  /** iPhone only. See pushPresentation in the domain package. */
  interruptionLevel?: 'passive' | 'active' | 'time-sensitive';
  /** iPhone app icon count: this person's unread alerts. Android shows its own. */
  badge?: number;
  /** iPhone groups notifications with the same thread, here one per trade. Nothing is replaced. */
  threadId?: string;
  /** What the app needs to order and de-duplicate alerts, and to open the right place. */
  data?: { tradeId: string | null; seq: number; tradeVersion: number | null; category: string; priority: string };
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

/** The most messages Expo accepts in one request. */
export const EXPO_BATCH_LIMIT = 100;

const EXPO_RETRYABLE = new Set(['MessageRateExceeded']);

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoSend {
  token: string;
  message: PushMessage;
}

function expoTicketResult(ticket: ExpoTicket, statusCode: number): PushResult {
  if (ticket.status === 'ok') return { kind: 'ACCEPTED', statusCode, receiptId: ticket.id };
  const code = ticket.details?.error ?? 'Unknown';
  if (code === 'DeviceNotRegistered') return { kind: 'GONE', statusCode, error: 'Device is no longer registered' };
  if (EXPO_RETRYABLE.has(code)) return { kind: 'RETRY', statusCode, error: `Expo: ${code}` };
  return { kind: 'FAILED', statusCode, error: `Expo: ${code}` };
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
    if (target.channel === 'WEB_PUSH') return this.sendWeb(target, message);
    const [result] = await this.sendExpoBatch([{ token: target.endpoint, message }]);
    return result as PushResult;
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

  /**
   * One result per message, in the same order. At most EXPO_BATCH_LIMIT messages.
   *
   * A rejected request does not say which message caused it, so the batch is split and each half tried
   * again. One bad token, such as one from another Expo project, then fails alone and cannot hold back
   * everyone else's alert.
   */
  async sendExpoBatch(items: ExpoSend[]): Promise<PushResult[]> {
    const forAll = (result: PushResult) => items.map(() => result);
    if (items.length === 0) return [];
    if (!env.EXPO_PUSH_ENABLED) {
      return forAll({ kind: 'FAILED', statusCode: null, error: 'Native push is not configured' });
    }
    let response: Response;
    try {
      response = await fetch(`${env.EXPO_PUSH_API_URL}/send`, {
        method: 'POST',
        headers: this.expoHeaders(),
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(
          items.map(({ token, message }) => ({
            to: token,
            title: message.title,
            body: message.body,
            sound: 'default',
            priority: message.urgent ? 'high' : 'normal',
            channelId: message.androidChannel,
            ttl: PUSH_TTL_SECONDS,
            ...(message.interruptionLevel ? { interruptionLevel: message.interruptionLevel } : {}),
            ...(message.badge !== undefined ? { badge: message.badge } : {}),
            ...(message.threadId ? { threadId: message.threadId } : {}),
            data: { path: message.path, eventId: message.tag, ...(message.data ?? {}) },
          })),
        ),
      });
    } catch (error) {
      return forAll({
        kind: 'RETRY',
        statusCode: null,
        error: `Network error: ${(error as Error).message}`.slice(0, 200),
      });
    }
    if (response.status === 429 || response.status >= 500) {
      return forAll({ kind: 'RETRY', statusCode: response.status, error: `Expo responded ${response.status}` });
    }
    if (!response.ok) {
      if (items.length > 1) {
        const middle = Math.ceil(items.length / 2);
        return [
          ...(await this.sendExpoBatch(items.slice(0, middle))),
          ...(await this.sendExpoBatch(items.slice(middle))),
        ];
      }
      return forAll({
        kind: 'FAILED',
        statusCode: response.status,
        error: `Expo rejected the request (${response.status})`,
      });
    }
    const payload = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
    const tickets = payload?.data;
    // Tickets are matched by position, so a list of the wrong length cannot be trusted at all.
    if (!Array.isArray(tickets) || tickets.length !== items.length) {
      return forAll({ kind: 'RETRY', statusCode: response.status, error: 'Expo returned the wrong number of tickets' });
    }
    return tickets.map((ticket) => expoTicketResult(ticket, response.status));
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
