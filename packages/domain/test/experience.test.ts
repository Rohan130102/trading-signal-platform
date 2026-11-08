import { describe, expect, it } from 'vitest';
import {
  allowedAnnouncementActions,
  announcementCreateSchema,
  announcementPriority,
  canArchiveTrade,
  canTakeAnnouncementAction,
  cleanAnnouncementText,
  countActiveFilters,
  decideDeviceBinding,
  DEFAULT_ANNOUNCEMENT_TEMPLATES,
  EMPTY_SIGNAL_FILTER,
  filterToQuery,
  historyQuery,
  installationIdSchema,
  isSafeAnnouncementLink,
  isSafeDeepLink,
  mobileDeepLinkPath,
  normaliseFilter,
  pushPresentation,
  signalsQuerySchema,
  statusesForGroup,
  tokenLoginSchema,
  unfilledPlaceholders,
} from '../src/index.js';

describe('notification presentation', () => {
  it('interrupts only for what changes what to do about a trade', () => {
    expect(pushPresentation('SIGNAL_PUBLISHED', 'NEW_SIGNAL', 'NORMAL')).toEqual({
      androidChannel: 'signals',
      urgent: true,
      interruptionLevel: 'time-sensitive',
    });
    expect(pushPresentation('STOP_MOVED', 'UPDATE', 'NORMAL')).toMatchObject({
      urgent: true,
      interruptionLevel: 'time-sensitive',
      androidChannel: 'updates',
    });
    expect(pushPresentation('TRADE_CLOSED', 'CLOSURE', 'NORMAL').interruptionLevel).toBe('time-sensitive');
    expect(pushPresentation('TARGETS_MODIFIED', 'UPDATE', 'NORMAL')).toMatchObject({
      urgent: false,
      interruptionLevel: 'active',
    });
    expect(pushPresentation('ANNOUNCEMENT', 'ANNOUNCEMENT', 'NORMAL', 'GENERAL')).toMatchObject({
      urgent: false,
      interruptionLevel: 'active',
      androidChannel: 'announcements',
    });
    expect(pushPresentation('ANNOUNCEMENT', 'ANNOUNCEMENT', 'NORMAL', 'EDUCATIONAL').interruptionLevel).toBe('passive');
    expect(pushPresentation('ANNOUNCEMENT', 'ANNOUNCEMENT', 'PRIORITY')).toMatchObject({
      urgent: true,
      interruptionLevel: 'time-sensitive',
      androidChannel: 'signals',
    });
  });

  it('never asks for a critical alert', () => {
    for (const type of ['SIGNAL_PUBLISHED', 'URGENT_INSTRUCTION', 'TRADE_CANCELLED'] as const) {
      expect(pushPresentation(type, 'UPDATE', 'PRIORITY').interruptionLevel).not.toBe('critical');
    }
  });

  it('opens announcements on the board and trades on their page, and accepts only known places', () => {
    expect(mobileDeepLinkPath(null, 'ANNOUNCEMENT')).toBe('/news');
    expect(mobileDeepLinkPath(null)).toBe('/feed');
    for (const place of ['/news', '/alerts', '/history']) expect(isSafeDeepLink(place)).toBe(true);
    expect(isSafeDeepLink('/news/../admin')).toBe(false);
    expect(isSafeDeepLink('/admin')).toBe(false);
  });
});

describe('device binding', () => {
  it('binds a new installation, allows its owner, blocks anyone else and never binds an administrator', () => {
    expect(decideDeviceBinding({ role: 'SUBSCRIBER', userId: 'a', boundUserId: null })).toBe('BIND');
    expect(decideDeviceBinding({ role: 'SUBSCRIBER', userId: 'a', boundUserId: 'a' })).toBe('ALLOW');
    expect(decideDeviceBinding({ role: 'SUBSCRIBER', userId: 'b', boundUserId: 'a' })).toBe('BLOCK');
    expect(decideDeviceBinding({ role: 'ADMIN', userId: 'b', boundUserId: 'a' })).toBe('EXEMPT');
  });

  it('accepts only an opaque, URL-safe identifier, and it is optional only at the schema', () => {
    expect(installationIdSchema.safeParse('0f'.repeat(16)).success).toBe(true);
    expect(installationIdSchema.safeParse('short').success).toBe(false);
    expect(installationIdSchema.safeParse(`${'a'.repeat(20)} OR 1=1`).success).toBe(false);
    expect(tokenLoginSchema.safeParse({ identifier: 'x', password: 'y' }).success).toBe(true);
    expect(tokenLoginSchema.safeParse({ identifier: 'x', password: 'y', platform: 'windows' }).success).toBe(false);
  });
});

describe('announcements', () => {
  it('allows each action only from the states that make sense', () => {
    const draft = { status: 'DRAFT' as const, deleted: false, everPublished: false };
    const live = { status: 'PUBLISHED' as const, deleted: false, everPublished: true };
    expect(allowedAnnouncementActions(draft)).toEqual(['EDIT', 'PUBLISH', 'SCHEDULE', 'DELETE', 'PURGE']);
    expect(canTakeAnnouncementAction(live, 'PUBLISH')).toBe(false);
    expect(canTakeAnnouncementAction(live, 'PURGE')).toBe(false);
    expect(canTakeAnnouncementAction({ ...live, deleted: true }, 'PURGE')).toBe(false);
    expect(canTakeAnnouncementAction({ ...live, deleted: true }, 'RESTORE')).toBe(true);
    expect(canTakeAnnouncementAction({ ...draft, deleted: true }, 'PURGE')).toBe(true);
    expect(canTakeAnnouncementAction({ status: 'ARCHIVED', deleted: false, everPublished: true }, 'EDIT')).toBe(false);
  });

  it('accepts only secure web links', () => {
    expect(isSafeAnnouncementLink('https://example.com/notice')).toBe(true);
    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,x',
      'https://user:pw@example.com',
      'https://localhost',
      'intent://x',
    ]) {
      expect(isSafeAnnouncementLink(bad)).toBe(false);
    }
  });

  it('keeps text plain, and treats an urgent announcement as a priority alert', () => {
    expect(cleanAnnouncementText('  Hello\u0007\r\n\r\n\r\n\r\nWorld  ')).toBe('Hello\n\nWorld');
    expect(announcementPriority('URGENT', 'NORMAL')).toBe('PRIORITY');
    expect(announcementPriority('GENERAL', 'NORMAL')).toBe('NORMAL');
  });

  it('needs a time to schedule, and a link for a button', () => {
    const base = { title: 'T', body: 'B', idempotencyKey: '8f14e45f-ceea-467f-a8f1-6f9d3b1c2a10' };
    expect(announcementCreateSchema.safeParse({ ...base, mode: 'SCHEDULE' }).success).toBe(false);
    expect(announcementCreateSchema.safeParse({ ...base, linkLabel: 'Read more' }).success).toBe(false);
    expect(announcementCreateSchema.safeParse({ ...base, title: '   ' }).success).toBe(false);
    const ok = announcementCreateSchema.parse(base);
    expect(ok).toMatchObject({ mode: 'PUBLISH', category: 'GENERAL', priority: 'NORMAL', pinned: false });
  });

  it('flags template placeholders that were not filled in', () => {
    expect(unfilledPlaceholders('Down on [date] from [start time].')).toEqual(['[date]', '[start time]']);
    expect(unfilledPlaceholders('All done.')).toEqual([]);
    for (const template of DEFAULT_ANNOUNCEMENT_TEMPLATES) {
      expect(template.title.length).toBeLessThanOrEqual(120);
    }
  });
});

describe('signal filters', () => {
  it('counts what is switched on and maps groups to real statuses', () => {
    expect(countActiveFilters(EMPTY_SIGNAL_FILTER)).toBe(0);
    expect(countActiveFilters({ symbols: ['XAU/USD', 'BTC/USD'], direction: 'SELL', status: 'OPEN' })).toBe(3);
    expect(statusesForGroup('ALL')).toBeNull();
    expect(statusesForGroup('OPEN')).toEqual(['PUBLISHED', 'ACTIVE', 'PARTIALLY_CLOSED']);
    expect(statusesForGroup('CLOSED')).toEqual(['CLOSED', 'CANCELLED', 'EXPIRED']);
  });

  it('drops anything unknown from a saved filter instead of failing', () => {
    expect(
      normaliseFilter({ symbols: ['XAU/USD', 'xau', 42, 'GONE/USD'], direction: 'UP', status: 'NOPE' }, ['XAU/USD']),
    ).toEqual({
      symbols: ['XAU/USD'],
      direction: null,
      status: 'ALL',
    });
    expect(normaliseFilter(null)).toEqual(EMPTY_SIGNAL_FILTER);
  });

  it('writes and reads the same query string', () => {
    const query = filterToQuery({ symbols: ['XAU/USD', 'BTC/USD'], direction: 'BUY', status: 'LIVE' });
    expect(query).toEqual({ symbols: 'XAU/USD,BTC/USD', direction: 'BUY', status: 'LIVE' });
    expect(signalsQuerySchema.parse(query)).toMatchObject({
      symbols: ['XAU/USD', 'BTC/USD'],
      direction: 'BUY',
      status: 'LIVE',
      limit: 20,
    });
    expect(filterToQuery(EMPTY_SIGNAL_FILTER)).toEqual({ symbols: undefined, direction: undefined, status: undefined });
    expect(historyQuery.parse({ symbols: 'XAU/USD', visibility: 'HIDDEN' })).toMatchObject({
      symbols: ['XAU/USD'],
      visibility: 'HIDDEN',
    });
    expect(signalsQuerySchema.safeParse({ symbols: 'bad symbol' }).success).toBe(false);
  });
});

describe('administrative archive', () => {
  it('only finished trades may leave the Signals list', () => {
    expect(canArchiveTrade('CLOSED')).toBe(true);
    expect(canArchiveTrade('CANCELLED')).toBe(true);
    expect(canArchiveTrade('EXPIRED')).toBe(true);
    expect(canArchiveTrade('ACTIVE')).toBe(false);
    expect(canArchiveTrade('PUBLISHED')).toBe(false);
    expect(canArchiveTrade('PARTIALLY_CLOSED')).toBe(false);
  });
});
