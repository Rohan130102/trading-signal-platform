import {
  type ArgumentMetadata,
  type ArgumentsHost,
  Body,
  Catch,
  createParamDecorator,
  type ExceptionFilter,
  type ExecutionContext,
  HttpException,
  type PipeTransform,
  Query,
  SetMetadata,
} from '@nestjs/common';
import { DomainError, type AccessDecision } from '@signaldesk/domain';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { log } from './log.js';
import { registerRouteDoc } from './openapi.js';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new AppError(404, 'NOT_FOUND', what);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have access to this.') =>
  new AppError(403, code, message);

const CONFLICT_CODES = new Set([
  'STALE_VERSION',
  'INVALID_TRANSITION',
  'WIDENS_RISK',
  'BASIS_MISMATCH',
  'EXECUTION_LOCKED',
]);

/** Shapes every failure the same way and keeps internals out of responses. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthedRequest>();
    const requestId = req.requestId;

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong on our side. Please try again.';
    let details: unknown;

    if (error instanceof AppError) {
      ({ status, code, message, details } = error);
    } else if (error instanceof DomainError) {
      status = CONFLICT_CODES.has(error.code) ? 409 : 422;
      code = error.code;
      message = error.message;
      details = error.issues.length > 0 ? { issues: error.issues } : undefined;
    } else if (error instanceof HttpException) {
      // Framework messages can quote parser internals, so they are never passed to the client.
      status = error.getStatus();
      code = status === 404 ? 'NOT_FOUND' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      message =
        status === 404 ? 'Not found' : status === 413 ? 'That request is too large.' : 'The request could not be read.';
    } else if (isBodyParserError(error)) {
      status = error.status;
      code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      message = status === 413 ? 'That request is too large.' : 'The request body could not be read.';
    }
    if (status >= 500) {
      log('error', 'request_failed', {
        requestId,
        path: req.path,
        method: req.method,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
    if (!res.headersSent) res.status(status).json({ error: { code, message, details, requestId } });
  }
}

function isBodyParserError(error: unknown): error is { status: number; type: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  );
}

export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _meta: ArgumentMetadata): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const issues = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      code: i.code.toUpperCase(),
      message: i.message,
    }));
    throw new AppError(422, 'VALIDATION', issues[0]?.message ?? 'That input is not valid.', { issues });
  }
}

/** Validated body: also feeds the generated OpenAPI document from the same schema. */
export const ZBody =
  (schema: z.ZodType): ParameterDecorator =>
  (target, key, index) => {
    registerRouteDoc(target, key as string, { body: schema });
    Body(new ZodPipe(schema))(target, key as string, index);
  };

export const ZQuery =
  (schema: z.ZodType): ParameterDecorator =>
  (target, key, index) => {
    registerRouteDoc(target, key as string, { query: schema });
    Query(new ZodPipe(schema))(target, key as string, index);
  };

export const Summary =
  (summary: string): MethodDecorator =>
  (target, key) => {
    registerRouteDoc(target, key as string, { summary });
  };

export const IS_PUBLIC = 'sd:public';
export const ROLES = 'sd:roles';
export const REQUIRES_SIGNAL_ACCESS = 'sd:signal-access';
export const ALLOW_INCOMPLETE = 'sd:allow-incomplete';

/** Routes are private unless marked public: forgetting a decorator fails closed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const AdminOnly = () => SetMetadata(ROLES, ['ADMIN']);
/** Requires an active subscription (or an admin) at the moment of the request. */
export const RequireSignalAccess = () => SetMetadata(REQUIRES_SIGNAL_ACCESS, true);
/** Reachable while a password change or MFA step is still outstanding. */
export const AllowIncompleteSession = () => SetMetadata(ALLOW_INCOMPLETE, true);

export interface AuthUser {
  id: string;
  role: 'ADMIN' | 'SUBSCRIBER';
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  name: string;
  loginId: string;
  mustChangePassword: boolean;
  mfaEnabledAt: Date | null;
  lastReadSeq: bigint;
}

export interface AuthContext {
  sessionId: string;
  user: AuthUser;
  subscription: { startsAt: Date; expiresAt: Date } | null;
  access: AccessDecision;
  mfaVerified: boolean;
  next: 'CHANGE_PASSWORD' | 'MFA_SETUP' | 'MFA_VERIFY' | null;
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
  requestId: string;
}

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
  return auth;
});

export const RequestId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest<AuthedRequest>().requestId,
);

export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest<AuthedRequest>().ip ?? 'unknown',
);

/** Native apps authenticate with a header, which unlike a cookie is never attached automatically. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // A malformed value is simply not a valid session.
    }
  }
  return out;
}
