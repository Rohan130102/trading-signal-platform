import { OTP_TTL_SECONDS } from '@signaldesk/domain';
import type { EmailMessage } from './email-transport.js';

/** Plain-text emails. Short, branded with the service name, and never carrying a password. */

const footer = (serviceName: string) => `\n\n— ${serviceName}`;

export function codeEmail(
  to: string,
  serviceName: string,
  code: string,
  purpose: 'REGISTRATION' | 'PASSWORD_RESET',
): EmailMessage {
  const minutes = Math.round(OTP_TTL_SECONDS / 60);
  const what = purpose === 'REGISTRATION' ? 'verify your email address' : 'confirm your password reset request';
  return {
    to,
    subject: `${serviceName} verification code: ${code}`,
    text:
      `Your ${serviceName} verification code is:\n\n    ${code}\n\n` +
      `Enter it in the app to ${what}. It expires in ${minutes} minutes and works once.\n\n` +
      `If you did not ask for this, you can ignore this email.${footer(serviceName)}`,
  };
}

/** Sent instead of a code when an address already has an account, so sign-up never reveals who is registered. */
export function accountExistsEmail(to: string, serviceName: string): EmailMessage {
  return {
    to,
    subject: `${serviceName}: you already have an account`,
    text:
      `Someone tried to create a ${serviceName} account with this email address, which already has one.\n\n` +
      `If it was you, log in with this email address, or use "Forgot Password?" on the login screen.\n\n` +
      `If it was not you, you can ignore this email.${footer(serviceName)}`,
  };
}

export function enquiryEmail(input: {
  to: string;
  serviceName: string;
  replyTo: string;
  name: string;
  email: string;
  mobile: string;
  registeredAt: string;
  enquiredAt: string;
  status: string;
  purpose: 'SUBSCRIPTION' | 'RENEWAL';
  source: string;
}): EmailMessage {
  return {
    to: input.to,
    replyTo: input.replyTo,
    subject: `${input.serviceName} — New ${input.purpose === 'RENEWAL' ? 'Renewal' : 'Subscription'} Enquiry`,
    text: [
      `A ${input.purpose === 'RENEWAL' ? 'renewal' : 'subscription'} enquiry was sent from the app.`,
      '',
      `Name: ${input.name}`,
      `Registered email: ${input.email}`,
      `Registered mobile: ${input.mobile}`,
      `Registered on: ${input.registeredAt}`,
      `Enquiry sent: ${input.enquiredAt}`,
      `Enquiry source: ${input.source}`,
      `Current status: ${input.status}`,
      '',
      'Reply to this email to answer them directly.',
    ].join('\n'),
  };
}

export function noticeEmail(to: string, serviceName: string, title: string, body: string): EmailMessage {
  return { to, subject: `${serviceName}: ${title}`, text: `${body}${footer(serviceName)}` };
}
