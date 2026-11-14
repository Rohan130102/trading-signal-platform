import { type CountryCode, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { z } from 'zod';

/**
 * Self-registration rules shared by the API (authoritative) and both apps (inline feedback), so a value that
 * passes on the phone also passes on the server.
 */

/**
 * Not a business choice. Under the Digital Personal Data Protection Act 2023 (s. 2(f), s. 9) anyone under 18 is a
 * child whose data needs verifiable parental consent, and under the Indian Contract Act 1872 (s. 11) a minor cannot
 * contract for a paid service.
 */
export const MIN_REGISTRATION_AGE = 18;
/** Above this an age is almost certainly a typing mistake. */
export const MAX_REGISTRATION_AGE = 120;
export const DEFAULT_PHONE_COUNTRY: CountryCode = 'IN';
export const NAME_MAX = 60;
export const PASSWORD_MIN = 10;

/** Email codes. */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;
/** How long a verified address may take to set its password. */
export const SETUP_TOKEN_TTL_SECONDS = 15 * 60;

/** Lower-cased and trimmed. The same address always becomes the same string. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Collapses runs of spaces. Any script is allowed: names are not checked against a character list. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

const nameField = (label: string) =>
  z
    .string()
    .transform(normalizeName)
    .pipe(
      z
        .string()
        .min(1, `Enter your ${label}`)
        .max(NAME_MAX, `Use at most ${NAME_MAX} characters`)
        // Letters of any language, marks, spaces and the punctuation real names use. Digits and symbols are not names.
        .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, `Enter a valid ${label}`),
    );

export const emailField = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email('Enter a valid email address').max(200, 'That email address is too long'));

export interface PhoneResult {
  /** E.164, such as +919876543210. */
  e164: string;
  /** For display, such as +91 98765 43210. */
  international: string;
}

/**
 * A mobile number, checked against the real numbering plan of its country. Numbers without a country code are
 * read as Indian. Returns null when the number is not a valid mobile number.
 */
export function parseMobileNumber(input: string, country: CountryCode = DEFAULT_PHONE_COUNTRY): PhoneResult | null {
  const trimmed = input.trim();
  if (!/^[+0-9 ()-]{6,24}$/.test(trimmed)) return null;
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) return null;
  const type = parsed.getType();
  if (type !== undefined && type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;
  return { e164: parsed.number, international: parsed.formatInternational() };
}

export function callingCode(country: CountryCode = DEFAULT_PHONE_COUNTRY): string {
  return `+${getCountryCallingCode(country)}`;
}

export const mobileField = z.string().transform((value, ctx) => {
  const phone = parseMobileNumber(value);
  if (!phone) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid mobile number' });
    return z.NEVER;
  }
  return phone.e164;
});

export const ageField = z
  .number({ error: 'Enter your age' })
  .int('Enter your age in whole years')
  .min(MIN_REGISTRATION_AGE, `You must be at least ${MIN_REGISTRATION_AGE} to create an account`)
  .max(MAX_REGISTRATION_AGE, 'Enter a valid age');

export const registrationSchema = z.strictObject({
  firstName: nameField('first name'),
  lastName: nameField('last name'),
  email: emailField,
  mobile: mobileField,
  age: ageField,
  /** The privacy notice was shown and accepted. Required: personal data is collected. */
  consent: z.literal(true, { error: 'Accept the privacy notice to continue' }),
});
export type RegistrationInput = z.input<typeof registrationSchema>;

export const otpCodeField = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`);

export const challengeIdField = z.uuid();

export const verifyCodeSchema = z.strictObject({ challengeId: challengeIdField, code: otpCodeField });
export const resendCodeSchema = z.strictObject({ challengeId: challengeIdField });

export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(200, 'Use at most 200 characters');

export const completeRegistrationSchema = z.strictObject({
  setupToken: z.string().min(20).max(200),
  password: newPasswordField,
  /** Native app only: binds the installation, as a normal sign-in does. */
  installationId: z.string().min(8).max(128).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  deviceLabel: z.string().trim().max(120).optional(),
});

export const passwordResetRequestSchema = z.strictObject({ email: emailField });

/** Plain guidance, not a score. Length matters most; the server also refuses common and personal passwords. */
export interface PasswordCheck {
  ok: boolean;
  hints: { text: string; met: boolean }[];
}

export function checkNewPassword(password: string, confirm: string): PasswordCheck {
  const hints = [
    { text: `At least ${PASSWORD_MIN} characters`, met: password.length >= PASSWORD_MIN },
    { text: 'Passwords match', met: password.length > 0 && password === confirm },
  ];
  return { ok: hints.every((h) => h.met), hints };
}

/** Masks an address for display after it was typed, e.g. "ra•••@gmail.com". */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${visible}${'•'.repeat(Math.max(1, Math.min(6, local.length - visible.length)))}@${domain}`;
}
