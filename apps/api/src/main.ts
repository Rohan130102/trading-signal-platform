import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule, CONTROLLERS } from './app.module.js';
import { SESSION_COOKIE } from './auth/session.guard.js';
import { type AuthedRequest, bearerToken } from './common/http.js';
import { log } from './common/log.js';
import { buildOpenApi } from './common/openapi.js';
import { rateLimiter } from './common/rate-limit.js';
import { env, isProduction } from './config/env.js';
import { WorkerService } from './notifications/worker.service.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Public steps a native app takes with no cookie and no Origin: signing in, and the steps before it. */
const NATIVE_PUBLIC_WRITES = new Set(
  [
    'auth/token',
    'auth/register',
    'auth/register/resend',
    'auth/register/verify',
    'auth/register/complete-token',
    'auth/password-reset',
    'auth/password-reset/resend',
    'auth/password-reset/verify',
  ].map((path) => `/api/v1/${path}`),
);

// A failed background promise must be seen, not take down every connected subscriber with it.
process.on('unhandledRejection', (reason) => {
  log('error', 'unhandled_rejection', { error: reason instanceof Error ? reason.message : String(reason) });
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn'],
    bodyParser: false,
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '64kb' });
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      strictTransportSecurity: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    const authed = req as AuthedRequest;
    authed.requestId = randomUUID();
    res.setHeader('X-Request-Id', authed.requestId);
    // Private responses must never be stored by a browser, a proxy or the service worker.
    res.setHeader('Cache-Control', 'no-store');
    const started = Date.now();
    res.on('finish', () => {
      if (res.statusCode >= 500 || Date.now() - started > 1000) {
        log('warn', 'slow_or_failed_request', {
          requestId: authed.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - started,
        });
      }
    });
    next();
  });
  app.use(rateLimiter(env.RATE_LIMIT_PER_MINUTE, SESSION_COOKIE));
  // Cross-site request protection for cookie authentication, including login. Browsers always send
  // Origin on these requests. Native apps send none and authenticate with a header that a cross-site
  // page cannot set, so only they may omit it. The steps before a native sign-in (sign-up, codes, recovery)
  // neither read nor set a cookie, so a cross-site page gains nothing from them; the web's own final sign-up step
  // sets the cookie and keeps the check.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin && (bearerToken(req.headers.authorization) || NATIVE_PUBLIC_WRITES.has(req.path))) return next();
    if (!origin || !env.APP_ORIGINS.includes(origin)) {
      res.status(403).json({ error: { code: 'BAD_ORIGIN', message: 'This request came from an unexpected origin.' } });
      return;
    }
    next();
  });

  const http = app.getHttpAdapter().getInstance();
  http.get('/api/v1/openapi.json', (_req: Request, res: Response) => {
    res.json(buildOpenApi(CONTROLLERS, 'api/v1'));
  });

  app.enableShutdownHooks();
  await app.init();
  await app.get(RealtimeGateway).attach(app.getHttpServer() as Server);
  if (env.RUN_WORKER_IN_API) await app.get(WorkerService).start();
  await app.listen(env.PORT);
  log('info', 'api_listening', { port: env.PORT, workerInProcess: env.RUN_WORKER_IN_API });
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
