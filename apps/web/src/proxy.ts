import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIES = ['sd_session', '__Host-sd_session'];

function connectSources(): string {
  const ws = process.env.NEXT_PUBLIC_WS_URL;
  return ["'self'", ws ? new URL(ws).origin : ''].filter(Boolean).join(' ');
}

/**
 * Sets a per-request CSP nonce and sends visitors with no session cookie to sign in. The redirect is
 * only a convenience: authorization is decided by the API on every request.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const privateArea =
    pathname === '/app' || pathname.startsWith('/app/') || pathname === '/admin' || pathname.startsWith('/admin/');
  if (privateArea && !SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV !== 'production';
  // Tied to the actual scheme, not the build: over plain HTTP this would block every script in WebKit.
  const isHttps = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources()}${isDev ? ' ws://localhost:3000' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isHttps ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isHttps) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

export const config = {
  matcher: [{ source: '/((?!api|_next/static|_next/image|sw.js|manifest.webmanifest|icon|favicon|offline.html).*)' }],
};
