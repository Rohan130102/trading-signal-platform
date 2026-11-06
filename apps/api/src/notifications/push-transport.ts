import { Injectable } from '@nestjs/common';
import webpush, { WebPushError } from 'web-push';
import { log } from '../common/log.js';
import { env } from '../config/env.js';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Devices collapse notifications with the same tag, so an accidental resend does not stack. */
  tag: string;
  urgent: boolean;
}

export type PushResult =
  | { kind: 'ACCEPTED'; statusCode: number }
  /** The push service says this device is gone. Do not try it again. */
  | { kind: 'GONE'; statusCode: number; error: string }
  | { kind: 'RETRY'; statusCode: number | null; error: string }
  | { kind: 'FAILED'; statusCode: number | null; error: string };

/** The time a push stays useful. A trading instruction hours late does more harm than none. */
export const PUSH_TTL_SECONDS = 3600;

/** Boundary to the outside world, so SMS or a native channel can be added beside it later. */
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

  get available(): boolean {
    return env.PUSH_TRANSPORT !== 'disabled';
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
}
