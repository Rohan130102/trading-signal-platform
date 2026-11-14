import { describe, expect, it } from 'vitest';
import {
  checkNewPassword,
  enquiryMessage,
  maskEmail,
  MIN_REGISTRATION_AGE,
  parseMobileNumber,
  registrationSchema,
  supportSettingsSchema,
  whatsappAppLink,
  whatsappDigits,
  whatsappWebLink,
} from '../src/index.js';

const valid = {
  firstName: '  Asha ',
  lastName: 'Rao  Kulkarni',
  email: ' Asha.Rao@Example.COM ',
  mobile: '98765 43210',
  age: 29,
  consent: true,
};

describe('registration details', () => {
  it('normalises names, email and mobile', () => {
    const parsed = registrationSchema.parse(valid);
    expect(parsed).toMatchObject({
      firstName: 'Asha',
      lastName: 'Rao Kulkarni',
      email: 'asha.rao@example.com',
      mobile: '+919876543210',
      age: 29,
    });
  });

  it('accepts real names in any script, and refuses digits and symbols', () => {
    expect(registrationSchema.safeParse({ ...valid, firstName: 'Zoë', lastName: "O'Brien-Smith" }).success).toBe(true);
    expect(registrationSchema.safeParse({ ...valid, firstName: 'आशा', lastName: 'राव' }).success).toBe(true);
    expect(registrationSchema.safeParse({ ...valid, firstName: 'Asha1' }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, lastName: '   ' }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, firstName: 'A'.repeat(61) }).success).toBe(false);
  });

  it('requires every one of the five fields and the privacy consent', () => {
    for (const field of ['firstName', 'lastName', 'email', 'mobile', 'age', 'consent'] as const) {
      const { [field]: _omitted, ...rest } = valid;
      expect(registrationSchema.safeParse(rest).success, field).toBe(false);
    }
    expect(registrationSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
  });

  it('refuses an invalid email', () => {
    for (const email of ['asha', 'asha@', '@example.com', 'asha rao@example.com']) {
      expect(registrationSchema.safeParse({ ...valid, email }).success, email).toBe(false);
    }
  });

  it('checks mobile numbers against the numbering plan, defaulting to India', () => {
    expect(parseMobileNumber('9876543210')?.e164).toBe('+919876543210');
    expect(parseMobileNumber('+91 98765-43210')?.international).toBe('+91 98765 43210');
    expect(parseMobileNumber('+44 7400 123456')?.e164).toBe('+447400123456');
    expect(parseMobileNumber('12345')).toBeNull();
    expect(parseMobileNumber('1234567890')).toBeNull(); // not a valid Indian mobile
    expect(parseMobileNumber('+91 22 2266 1234')).toBeNull(); // a Mumbai landline
    expect(parseMobileNumber('phone')).toBeNull();
  });

  it('applies the legal minimum age and refuses impossible ages', () => {
    expect(registrationSchema.safeParse({ ...valid, age: MIN_REGISTRATION_AGE }).success).toBe(true);
    expect(registrationSchema.safeParse({ ...valid, age: MIN_REGISTRATION_AGE - 1 }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, age: 0 }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, age: -3 }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, age: 25.5 }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, age: 121 }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, age: '29' }).success).toBe(false);
  });

  it('guides a new password by length and match only', () => {
    expect(checkNewPassword('short', 'short').ok).toBe(false);
    expect(checkNewPassword('long enough pass', 'long enough pas').ok).toBe(false);
    expect(checkNewPassword('long enough pass', 'long enough pass').ok).toBe(true);
  });

  it('masks an address for display', () => {
    expect(maskEmail('asha.rao@example.com')).toBe('as••••••@example.com');
    expect(maskEmail('a@b.co')).toBe('a•@b.co');
  });
});

describe('subscription enquiries', () => {
  const person = { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', mobile: '+919876543210' };

  it('fills the template from the account, and leaves out anything sensitive', () => {
    const text = enquiryMessage(person, 'Signal Desk', 'SUBSCRIPTION');
    expect(text).toBe(
      [
        'Hello Signal Desk Support,',
        '',
        'I have created my Signal Desk account and would like to enquire about the available subscription plans.',
        '',
        'Name: Asha Rao',
        'Registered Email: asha@example.com',
        'Registered Mobile: +919876543210',
        '',
        'Please share the subscription details and activation process.',
        'Thank you.',
      ].join('\n'),
    );
    expect(text).not.toMatch(/age|password|otp/i);
    expect(enquiryMessage(person, 'Signal Desk', 'RENEWAL')).toContain(
      'I would like to renew my Signal Desk subscription.',
    );
  });

  it('puts only digits in the wa.me path and encodes the message', () => {
    expect(whatsappDigits('+91-9987255414')).toBe('919987255414');
    expect(whatsappDigits('+91 99872 55414')).toBe('919987255414');
    expect(whatsappDigits('not a number')).toBeNull();
    const link = whatsappWebLink('+91-9987255414', 'Hello & thanks\nName: A');
    expect(link).toBe('https://wa.me/919987255414?text=Hello%20%26%20thanks%0AName%3A%20A');
    expect(whatsappAppLink('+91-9987255414', 'Hi')).toBe('whatsapp://send?phone=919987255414&text=Hi');
    expect(whatsappWebLink('nope', 'Hi')).toBeNull();
  });

  it('validates the support contact settings', () => {
    expect(
      supportSettingsSchema.parse({ supportWhatsapp: '+91-9987255414', supportEmail: ' Help@Example.com ' }),
    ).toEqual({
      supportWhatsapp: '+919987255414',
      supportEmail: 'help@example.com',
    });
    expect(supportSettingsSchema.safeParse({ supportWhatsapp: '12', supportEmail: 'help@example.com' }).success).toBe(
      false,
    );
    expect(supportSettingsSchema.safeParse({ supportWhatsapp: '+919987255414', supportEmail: 'help' }).success).toBe(
      false,
    );
  });
});
