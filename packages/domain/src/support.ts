import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { normalizeEmail } from './registration.js';

/**
 * Subscription enquiries and the support contact they go to. The number and address live in the settings table;
 * every screen and email reads them from there, so changing them needs no release.
 */

export const DEFAULT_SUPPORT_WHATSAPP = '+919987255414';
export const DEFAULT_SUPPORT_EMAIL = 'singhrohan130102@gmail.com';

export const ENQUIRY_STATUSES = ['NOT_CONTACTED', 'INITIATED', 'UNDER_DISCUSSION', 'RESOLVED'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  NOT_CONTACTED: 'Not contacted',
  INITIATED: 'Enquiry started',
  UNDER_DISCUSSION: 'Under discussion',
  RESOLVED: 'Resolved',
};

export const ENQUIRY_CHANNELS = ['WHATSAPP', 'EMAIL'] as const;
export type EnquiryChannel = (typeof ENQUIRY_CHANNELS)[number];

/** What actually happened. Opening WhatsApp proves nothing about a message being sent. */
export const ENQUIRY_OUTCOMES = ['LINK_OPENED', 'EMAIL_QUEUED', 'EMAIL_SENT', 'EMAIL_FAILED'] as const;
export type EnquiryOutcome = (typeof ENQUIRY_OUTCOMES)[number];

/** Why a subscription enquiry is being made, which changes the wording only. */
export type EnquiryPurpose = 'SUBSCRIPTION' | 'RENEWAL';

/** Digits only, country code first: the form wa.me and whatsapp:// expect. Null when not a valid number. */
export function whatsappDigits(number: string): string | null {
  const parsed = parsePhoneNumberFromString(number.trim(), 'IN');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number.replace(/^\+/, '');
}

export const supportWhatsappField = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const digits = whatsappDigits(value);
    if (!digits) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number with its country code' });
      return z.NEVER;
    }
    return `+${digits}`;
  });

export const supportEmailField = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email('Enter a valid email address').max(200));

export const supportSettingsSchema = z.strictObject({
  supportWhatsapp: supportWhatsappField,
  supportEmail: supportEmailField,
});
export type SupportSettingsInput = z.input<typeof supportSettingsSchema>;

export interface EnquiryPerson {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
}

/** Only name, email and mobile go in. Never age, passwords, codes or internal identifiers. */
export function enquiryMessage(person: EnquiryPerson, serviceName: string, purpose: EnquiryPurpose): string {
  const ask =
    purpose === 'RENEWAL'
      ? `I would like to renew my ${serviceName} subscription.`
      : `I have created my ${serviceName} account and would like to enquire about the available subscription plans.`;
  const close =
    purpose === 'RENEWAL'
      ? 'Please share the renewal details.'
      : 'Please share the subscription details and activation process.';
  return [
    `Hello ${serviceName} Support,`,
    '',
    ask,
    '',
    `Name: ${person.firstName} ${person.lastName}`.trimEnd(),
    `Registered Email: ${person.email}`,
    `Registered Mobile: ${person.mobile}`,
    '',
    close,
    'Thank you.',
  ].join('\n');
}

/** The official universal link. Works in a browser and opens the app where it is installed. */
export function whatsappWebLink(supportNumber: string, message: string): string | null {
  const digits = whatsappDigits(supportNumber);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}

/** The app's own scheme. Opening it fails when WhatsApp is not installed, which is how the phone app knows. */
export function whatsappAppLink(supportNumber: string, message: string): string | null {
  const digits = whatsappDigits(supportNumber);
  return digits ? `whatsapp://send?phone=${digits}&text=${encodeURIComponent(message)}` : null;
}

export const enquirySchema = z.strictObject({
  channel: z.enum(ENQUIRY_CHANNELS),
  purpose: z.enum(['SUBSCRIPTION', 'RENEWAL']).default('SUBSCRIPTION'),
  /** Set by the phone app when the system reported WhatsApp missing, so the email went out instead. */
  whatsappUnavailable: z.boolean().default(false),
  idempotencyKey: z.uuid(),
});
