import { z } from 'zod';
import type { SettingsInput } from './contracts.js';
import { emailField } from './registration.js';

/**
 * What the Super Admin can configure without a code change, beyond the platform rules in `contracts.ts`.
 * Email is configured here so sign-up codes and account emails work as soon as the details are entered.
 */

export const EMAIL_SECURITY = ['STARTTLS', 'TLS'] as const;
export type EmailSecurity = (typeof EMAIL_SECURITY)[number];

export const EMAIL_SECURITY_LABELS: Record<EmailSecurity, string> = {
  STARTTLS: 'STARTTLS (usually port 587)',
  TLS: 'SSL/TLS (usually port 465)',
};

export interface EmailPreset {
  id: 'GMAIL' | 'OUTLOOK' | 'OTHER';
  label: string;
  host: string;
  port: number;
  security: EmailSecurity;
  /** What to enter as the password, in plain words. */
  passwordHint: string;
}

/** The common providers, so the Super Admin only types the address and password. */
export const EMAIL_PRESETS: readonly EmailPreset[] = [
  {
    id: 'GMAIL',
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    security: 'STARTTLS',
    passwordHint: 'Use an app password: Google Account, Security, 2-Step Verification, App passwords.',
  },
  {
    id: 'OUTLOOK',
    label: 'Outlook',
    host: 'smtp.office365.com',
    port: 587,
    security: 'STARTTLS',
    passwordHint: 'Use the mailbox password, or an app password if two-step sign-in is on.',
  },
  {
    id: 'OTHER',
    label: 'Other',
    host: '',
    port: 587,
    security: 'STARTTLS',
    passwordHint: 'The SMTP password your email provider gives you.',
  },
];

/** The preset these details match, so the screen can show the right choice when it opens. */
export function emailPresetFor(host: string): EmailPreset['id'] {
  const match = EMAIL_PRESETS.find((p) => p.host !== '' && p.host === host.trim().toLowerCase());
  return match?.id ?? 'OTHER';
}

const hostField = z
  .string()
  .trim()
  .toLowerCase()
  .max(253, 'That server name is too long')
  .regex(
    /^$|^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
    'Enter a server name such as smtp.gmail.com',
  );

export const emailSettingsSchema = z
  .strictObject({
    /** Off: nothing is sent from these details. */
    enabled: z.boolean(),
    host: hostField,
    port: z.number({ error: 'Enter a port' }).int('Enter a whole number').min(1).max(65535),
    security: z.enum(EMAIL_SECURITY),
    username: z.string().trim().max(320),
    /** Left out or empty: keep the saved password. It is never sent back to any screen. */
    password: z.string().max(500).optional(),
    fromName: z.string().trim().max(100),
    fromAddress: z.union([z.literal(''), emailField]),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) return;
    if (!value.host) ctx.addIssue({ code: 'custom', path: ['host'], message: 'Enter the SMTP server' });
    if (!value.fromAddress) {
      ctx.addIssue({ code: 'custom', path: ['fromAddress'], message: 'Enter the address emails come from' });
    }
  });
export type EmailSettingsInput = z.output<typeof emailSettingsSchema>;

export const emailTestSchema = z.strictObject({ to: emailField });

/**
 * READY: these details are saved and switched on. SERVER: the server's own configuration is used instead.
 * NOT_SET_UP: nothing can be sent, so sign-up is paused.
 */
export const EMAIL_STATUSES = ['READY', 'SERVER', 'NOT_SET_UP'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export interface EmailSettingsView {
  enabled: boolean;
  host: string;
  port: number;
  security: EmailSecurity;
  username: string;
  /** Whether a password is saved. The password itself never leaves the server. */
  passwordSet: boolean;
  fromName: string;
  fromAddress: string;
  /** The last time a test email was accepted with these details. */
  testedAt: string | null;
  status: EmailStatus;
}

export const EMAIL_STATUS_COPY: Record<EmailStatus, { title: string; body: string }> = {
  READY: { title: 'Email is working', body: 'Sign-up codes and account emails are sent with these details.' },
  SERVER: {
    title: 'Using the server’s email settings',
    body: 'Emails are sent with settings from the server. Enter details here to manage them from this screen.',
  },
  NOT_SET_UP: {
    title: 'Email is not set up',
    body: 'Sign-up codes cannot be sent until it is. Meanwhile, people who sign up are asked to send their details to you on WhatsApp.',
  },
};

/**
 * Whether sign-up can finish online right now: the Super Admin allows it, and a code can actually be sent. The
 * form is shown whenever sign-up is open; without email it ends by sending the details to the team instead.
 */
export function signupAvailable(signupOpen: boolean, emailStatus: EmailStatus): boolean {
  return signupOpen && emailStatus !== 'NOT_SET_UP';
}

/** What administrators read from the settings endpoint: every platform setting, and never a secret. */
export type AdminSettings = Required<SettingsInput> & { id: number; updatedAt: string; dataResetAt: string | null };

/** The fields of `AdminSettings` that can be saved, in the order the configuration screen shows them. */
export const ADMIN_SETTINGS_FIELDS = [
  'serviceName',
  'serviceDescription',
  'businessTimezone',
  'aboutBody',
  'supportWhatsapp',
  'supportEmail',
  'supportContact',
  'renewalInstructions',
  'signupOpen',
  'defaultTrialDays',
  'signalStartMode',
  'entryExpiryMinutesDefault',
  'trailingStopWording',
  'screenshotsAllowedDefault',
  'historyScope',
  'legalEntityName',
  'regulatoryStatement',
  'riskDisclosure',
  'privacyNotice',
] as const satisfies readonly (keyof SettingsInput)[];

/** The body for saving settings: exactly the savable fields, so nothing read-only is ever sent back. */
export function settingsBody(settings: AdminSettings, change: Partial<SettingsInput> = {}): SettingsInput {
  const merged = { ...settings, ...change };
  return Object.fromEntries(ADMIN_SETTINGS_FIELDS.map((k) => [k, merged[k]])) as unknown as SettingsInput;
}
