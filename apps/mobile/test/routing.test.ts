import type { MeResponse } from '@signaldesk/domain';
import { gateRedirect, resolveDeepLink, type SessionPhase } from '@/lib/routing';

const me = (over: Partial<MeResponse> = {}): MeResponse =>
  ({
    role: 'SUBSCRIBER',
    next: null,
    access: { allowed: true, reason: null },
    ...over,
  }) as MeResponse;
const signedIn = (over: Partial<MeResponse> = {}): SessionPhase => ({ phase: 'signed-in', me: me(over) });

describe('where someone belongs', () => {
  it('waits while the session is being worked out', () => {
    for (const phase of ['starting', 'loading', 'unreachable'] as const) {
      expect(gateRedirect({ phase }, ['(subscriber)', 'feed'])).toBeNull();
    }
  });

  it('sends anyone signed out to the sign-in screen, wherever they tried to go', () => {
    const out: SessionPhase = { phase: 'signed-out' };
    expect(gateRedirect(out, [])).toBe('/login');
    expect(gateRedirect(out, ['trades', 'abc'])).toBe('/login');
    expect(gateRedirect(out, ['(admin)', 'dashboard'])).toBe('/login');
    expect(gateRedirect(out, ['(auth)', 'set-password'])).toBe('/login');
    expect(gateRedirect(out, ['(auth)', 'login'])).toBeNull();
  });

  it('lets anyone read the risk disclosure', () => {
    expect(gateRedirect({ phase: 'signed-out' }, ['disclosures'])).toBeNull();
    expect(gateRedirect(signedIn(), ['disclosures'])).toBeNull();
  });

  it('holds a person at a required step until it is done', () => {
    expect(gateRedirect(signedIn({ next: 'CHANGE_PASSWORD' }), ['(subscriber)', 'feed'])).toBe('/set-password');
    expect(gateRedirect(signedIn({ next: 'MFA_SETUP', role: 'ADMIN' }), ['(admin)', 'dashboard'])).toBe('/mfa-setup');
    expect(gateRedirect(signedIn({ next: 'MFA_VERIFY', role: 'ADMIN' }), ['compose'])).toBe('/mfa-verify');
    expect(gateRedirect(signedIn({ next: 'MFA_VERIFY', role: 'ADMIN' }), ['(auth)', 'mfa-verify'])).toBeNull();
  });

  it('keeps subscribers away from administrator screens', () => {
    expect(gateRedirect(signedIn(), ['(admin)', 'dashboard'])).toBe('/feed');
    expect(gateRedirect(signedIn(), ['admin', 'trades', 'abc'])).toBe('/feed');
    expect(gateRedirect(signedIn(), ['compose'])).toBe('/feed');
    expect(gateRedirect(signedIn(), ['(auth)', 'login'])).toBe('/feed');
    expect(gateRedirect(signedIn(), [])).toBe('/feed');
    expect(gateRedirect(signedIn(), ['(subscriber)', 'history'])).toBeNull();
    expect(gateRedirect(signedIn(), ['trades', 'abc'])).toBeNull();
  });

  it('shows only the renewal screen once access has ended', () => {
    const expired = signedIn({ access: { allowed: false, reason: 'SUBSCRIPTION_EXPIRED' } });
    expect(gateRedirect(expired, ['(subscriber)', 'feed'])).toBe('/access-ended');
    expect(gateRedirect(expired, ['trades', 'abc'])).toBe('/access-ended');
    expect(gateRedirect(expired, ['access-ended'])).toBeNull();
  });

  it('sends administrators to their desk, and their trades to their own screen', () => {
    const admin = signedIn({ role: 'ADMIN' });
    expect(gateRedirect(admin, [])).toBe('/dashboard');
    expect(gateRedirect(admin, ['(subscriber)', 'feed'])).toBe('/dashboard');
    expect(gateRedirect(admin, ['trades', 'abc'])).toBe('/admin/trades/abc');
    expect(gateRedirect(admin, ['compose'])).toBeNull();
    expect(gateRedirect(admin, ['admin', 'performance'])).toBeNull();
  });
});

describe('opening a notification', () => {
  const trade = '/trades/8f14e45f-ceea-467f-a8f1-6f9d3b1c2a10';
  it('leads a subscriber to the trade', () => {
    expect(resolveDeepLink(me(), trade)).toBe(trade);
    expect(resolveDeepLink(me(), '/feed')).toBe('/feed');
  });
  it('leads nowhere private once access has ended', () => {
    expect(resolveDeepLink(me({ access: { allowed: false, reason: 'SUBSCRIPTION_EXPIRED' } }), trade)).toBeNull();
  });
  it('leads an administrator to their version of the trade', () => {
    const admin = me({ role: 'ADMIN' });
    expect(resolveDeepLink(admin, trade)).toBe(`/admin${trade}`);
    expect(resolveDeepLink(admin, '/account')).toBe('/admin/account');
    expect(resolveDeepLink(admin, '/feed')).toBe('/dashboard');
  });
});
