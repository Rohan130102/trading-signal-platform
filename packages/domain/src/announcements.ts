import { z } from 'zod';
import { PRIORITIES, type Priority } from './status.js';

/**
 * Announcements are the administrator's messages that are not about one trade. The editable record lives
 * in its own table; publishing appends an ANNOUNCEMENT event, so what was sent stays in the append-only
 * history even if the announcement is later edited or archived.
 */

export const ANNOUNCEMENT_CATEGORIES = [
  'GENERAL',
  'IMPORTANT',
  'MARKET_UPDATE',
  'MAINTENANCE',
  'EDUCATIONAL',
  'URGENT',
] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  GENERAL: 'General',
  IMPORTANT: 'Important',
  MARKET_UPDATE: 'Market update',
  MAINTENANCE: 'Maintenance',
  EDUCATIONAL: 'Educational',
  URGENT: 'Urgent',
};

export const ANNOUNCEMENT_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_ACTIONS = [
  'EDIT',
  'PUBLISH',
  'SCHEDULE',
  'UNSCHEDULE',
  'ARCHIVE',
  'RESTORE',
  'DELETE',
  'PURGE',
] as const;
export type AnnouncementAction = (typeof ANNOUNCEMENT_ACTIONS)[number];

export interface AnnouncementState {
  status: AnnouncementStatus;
  /** Moved to the bin. Restorable. */
  deleted: boolean;
  /** Ever sent to subscribers. A sent announcement keeps its event, so it can never be purged. */
  everPublished: boolean;
}

/** Which actions an administrator may take from here. The API enforces the same table. */
export function allowedAnnouncementActions(state: AnnouncementState): AnnouncementAction[] {
  if (state.deleted) return state.everPublished ? ['RESTORE'] : ['RESTORE', 'PURGE'];
  switch (state.status) {
    case 'DRAFT':
      return ['EDIT', 'PUBLISH', 'SCHEDULE', 'DELETE', 'PURGE'];
    case 'SCHEDULED':
      return ['EDIT', 'PUBLISH', 'UNSCHEDULE', 'DELETE', 'PURGE'];
    case 'PUBLISHED':
      return ['EDIT', 'ARCHIVE', 'DELETE'];
    case 'ARCHIVED':
      return ['RESTORE', 'DELETE'];
  }
}

export function canTakeAnnouncementAction(state: AnnouncementState, action: AnnouncementAction): boolean {
  return allowedAnnouncementActions(state).includes(action);
}

/**
 * Only secure web links can be attached. Anything else (javascript:, data:, intent: and the like) is
 * refused, because the link is opened from inside the app.
 */
export function isSafeAnnouncementLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Plain text only: control characters other than line breaks are removed, and runs of blank lines shortened. */
export function cleanAnnouncementText(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** A category that must interrupt is always sent as a priority alert, whatever the toggle says. */
export function announcementPriority(category: AnnouncementCategory, requested: Priority): Priority {
  return category === 'URGENT' ? 'PRIORITY' : requested;
}

const instant = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().transform(cleanAnnouncementText).pipe(z.string().max(max));

const linkFields = {
  linkUrl: z
    .string()
    .trim()
    .max(500)
    .refine(isSafeAnnouncementLink, 'Use a full https:// address')
    .nullable()
    .default(null),
  linkLabel: z.string().trim().max(40).nullable().default(null),
};

const contentFields = {
  title: text(120).pipe(z.string().min(1, 'Give it a title')),
  body: text(2000).pipe(z.string().min(1, 'Write the announcement')),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).default('GENERAL'),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  pinned: z.boolean().default(false),
  expiresAt: instant.nullable().default(null),
  ...linkFields,
};

/**
 * One request either saves a draft, publishes now or schedules. Repeating it with the same key returns the
 * same announcement, so a double tap cannot send twice.
 */
export const announcementCreateSchema = z
  .strictObject({
    ...contentFields,
    mode: z.enum(['DRAFT', 'PUBLISH', 'SCHEDULE']).default('PUBLISH'),
    publishAt: instant.nullable().default(null),
    idempotencyKey: z.uuid(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'SCHEDULE' && !value.publishAt) {
      ctx.addIssue({ code: 'custom', path: ['publishAt'], message: 'Choose when to publish' });
    }
    if (value.linkLabel && !value.linkUrl) {
      ctx.addIssue({ code: 'custom', path: ['linkUrl'], message: 'Add the link the button opens' });
    }
    if (value.expiresAt && value.publishAt && new Date(value.expiresAt) <= new Date(value.publishAt)) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'It must end after it is published' });
    }
  });
export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;

export const announcementUpdateSchema = z
  .strictObject({
    ...contentFields,
    publishAt: instant.nullable().default(null),
    expectedVersion: z.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    if (value.linkLabel && !value.linkUrl) {
      ctx.addIssue({ code: 'custom', path: ['linkUrl'], message: 'Add the link the button opens' });
    }
  });
export type AnnouncementUpdateInput = z.infer<typeof announcementUpdateSchema>;

export const announcementScheduleSchema = z.strictObject({
  publishAt: instant,
  expectedVersion: z.number().int().min(0),
});

export const announcementActionSchema = z.strictObject({ expectedVersion: z.number().int().min(0) });

/** Permanent deletion has to be spelled out, so it cannot be sent by accident. */
export const announcementPurgeSchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  confirm: z.literal('PERMANENTLY_DELETE'),
});

export const ADMIN_ANNOUNCEMENT_VIEWS = ['ALL', 'LIVE', 'SCHEDULED', 'DRAFT', 'ARCHIVED', 'BIN'] as const;
export type AdminAnnouncementView = (typeof ADMIN_ANNOUNCEMENT_VIEWS)[number];

export const adminAnnouncementsQuery = z.object({
  view: z.enum(ADMIN_ANNOUNCEMENT_VIEWS).default('ALL'),
  q: z.string().trim().max(60).optional(),
});

export const announcementsQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const announcementBulkSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(200),
  action: z.enum(['ARCHIVE', 'RESTORE', 'DELETE']),
  /** The count the administrator confirmed. A mismatch means the selection changed underneath them. */
  expectedCount: z.number().int().min(1).max(200),
});

export const announcementTemplateSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  category: z.enum(ANNOUNCEMENT_CATEGORIES),
  title: text(120).pipe(z.string().min(1)),
  body: text(2000).pipe(z.string().min(1)),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10000).default(100),
});
export type AnnouncementTemplateInput = z.infer<typeof announcementTemplateSchema>;

/** What a subscriber sees. */
export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  priority: Priority;
  pinned: boolean;
  linkUrl: string | null;
  linkLabel: string | null;
  publishedAt: string;
  editedAt: string | null;
  expiresAt: string | null;
}

export interface AnnouncementsPage {
  announcements: AnnouncementView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminAnnouncement extends Omit<AnnouncementView, 'publishedAt'> {
  status: AnnouncementStatus;
  deleted: boolean;
  everPublished: boolean;
  publishedAt: string | null;
  publishAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  version: number;
  allowedActions: AnnouncementAction[];
}

export interface AdminAnnouncementsPage {
  announcements: AdminAnnouncement[];
  counts: Record<'LIVE' | 'SCHEDULED' | 'DRAFT' | 'ARCHIVED' | 'BIN', number>;
}

export interface AnnouncementTemplate extends AnnouncementTemplateInput {
  id: string;
}

/** Starting points an administrator edits. Square brackets mark what must be filled in before sending. */
export const DEFAULT_ANNOUNCEMENT_TEMPLATES: AnnouncementTemplateInput[] = [
  {
    name: 'Markets closed',
    category: 'GENERAL',
    title: 'Markets are closed today',
    body: 'There will be no new signals today because the markets are closed. Open trades stay as they are, and any change to them will still be sent.',
    active: true,
    sortOrder: 10,
  },
  {
    name: 'Market update',
    category: 'MARKET_UPDATE',
    title: 'Market update',
    body: '[Summarise what changed in the market and what it means for open trades.]',
    active: true,
    sortOrder: 20,
  },
  {
    name: 'Important notice',
    category: 'IMPORTANT',
    title: 'Important notice',
    body: '[Write the notice here.]',
    active: true,
    sortOrder: 30,
  },
  {
    name: 'Scheduled maintenance',
    category: 'MAINTENANCE',
    title: 'Scheduled maintenance',
    body: 'SignalDesk will be unavailable on [date] from [start time] to [end time] for maintenance. Signals sent before then are not affected. Check the app once it is back.',
    active: true,
    sortOrder: 40,
  },
  {
    name: 'How to read a signal',
    category: 'EDUCATIONAL',
    title: 'How to read a signal',
    body: 'Every signal shows the instrument, BUY or SELL, the entry, the stop-loss and the targets. Updates appear under the original signal, so you can always see what changed and when. Notifications can be delayed, so check the app before acting.',
    active: true,
    sortOrder: 50,
  },
  {
    name: 'Urgent instruction',
    category: 'URGENT',
    title: 'Urgent: please read now',
    body: '[Say exactly what subscribers should check or do.]',
    active: true,
    sortOrder: 60,
  },
];

/** Bracketed placeholders still in the text, so the composer can stop an unfinished template going out. */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[[^\]\n]{1,60}\]/g) ?? [])];
}
