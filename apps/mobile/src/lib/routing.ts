import type { MeResponse } from '@signaldesk/domain';

export type SessionPhase =
  | { phase: 'starting' }
  | { phase: 'signed-out' }
  /** Have a token but cannot yet say who it belongs to. */
  | { phase: 'loading' }
  | { phase: 'unreachable' }
  | { phase: 'signed-in'; me: MeResponse };

const PUBLIC = new Set(['disclosures']);
/** The ways in, for someone not signed in. */
const SIGNED_OUT = new Set(['login', 'signup', 'forgot-password']);

/**
 * Where someone belongs, decided from the server's answer. This only chooses screens: the API refuses
 * anything this would have hidden. Returns null when the current screen is already right.
 */
export function gateRedirect(state: SessionPhase, segments: readonly string[]): string | null {
  const first = segments[0] ?? '';
  if (state.phase === 'starting' || state.phase === 'loading' || state.phase === 'unreachable') return null;
  if (PUBLIC.has(first)) return null;
  if (state.phase === 'signed-out') return first === '(auth)' && SIGNED_OUT.has(segments[1] ?? '') ? null : '/login';

  const { me } = state;
  const step =
    me.next === 'CHANGE_PASSWORD'
      ? 'set-password'
      : me.next === 'MFA_SETUP'
        ? 'mfa-setup'
        : me.next === 'MFA_VERIFY'
          ? 'mfa-verify'
          : null;
  if (step) return first === '(auth)' && segments[1] === step ? null : `/${step}`;

  if (me.role === 'ADMIN') {
    if (first === '(admin)' || first === 'admin' || first === 'compose') return null;
    if (first === 'trades' && segments[1]) return `/admin/trades/${segments[1]}`;
    return '/dashboard';
  }
  // Signed in without access: the status screen, or the welcome straight after sign-up.
  if (!me.access.allowed) return first === 'access-ended' || first === 'welcome' ? null : '/access-ended';
  if (first === '(subscriber)' || first === 'trades' || first === 'onboarding') return null;
  return '/feed';
}

/** Where a notification or link leads for this person. The two roles keep trades in different places. */
export function resolveDeepLink(me: Pick<MeResponse, 'role' | 'access'>, path: string): string | null {
  if (me.role === 'ADMIN') {
    if (path.startsWith('/trades/')) return `/admin/trades/${path.slice('/trades/'.length)}`;
    return path === '/account' ? '/admin/account' : '/dashboard';
  }
  return me.access.allowed ? path : null;
}
