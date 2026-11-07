import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { type AuthedRequest, bearerToken, parseCookies } from './http.js';

const WINDOW_MS = 60_000;
/** How long a session that passed authentication keeps its own allowance without proving itself again. */
const TRUSTED_SESSION_MS = 15 * 60_000;

class MinuteCounters {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, now: number): { count: number; resetAt: number } {
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    return entry;
  }

  sweep(now: number): void {
    for (const [key, entry] of this.windows) if (entry.resetAt <= now) this.windows.delete(key);
  }
}

/**
 * Mobile networks put many people behind one public address, so subscribers who all open the app after
 * a signal must not use up one shared allowance. A session that has passed authentication counts on its
 * own. Everything else counts against its address: anonymous requests, and any credential not yet proven.
 * Validating a credential needs the database, so a made-up one earns nothing here and cannot be used to
 * get round the address limit.
 */
export function rateLimiter(limitPerMinute: number, sessionCookie: string) {
  const addresses = new MinuteCounters();
  const sessions = new MinuteCounters();
  const trustedUntil = new Map<string, number>();

  setInterval(() => {
    const now = Date.now();
    addresses.sweep(now);
    sessions.sweep(now);
    for (const [key, until] of trustedUntil) if (until <= now) trustedUntil.delete(key);
  }, WINDOW_MS).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) return next();
    const now = Date.now();
    const credential = bearerToken(req.headers.authorization) ?? parseCookies(req.headers.cookie)[sessionCookie];
    // Hashed so that this long-lived map never holds a usable credential.
    const session = credential ? createHash('sha256').update(credential).digest('base64url') : null;
    const trusted = session !== null && (trustedUntil.get(session) ?? 0) > now;
    const entry = trusted ? sessions.hit(session, now) : addresses.hit(req.ip ?? 'unknown', now);
    if (entry.count > limitPerMinute) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
      });
      return;
    }
    if (session) {
      res.once('finish', () => {
        if ((req as AuthedRequest).auth) trustedUntil.set(session, Date.now() + TRUSTED_SESSION_MS);
        else if (res.statusCode === 401) trustedUntil.delete(session);
      });
    }
    next();
  };
}
