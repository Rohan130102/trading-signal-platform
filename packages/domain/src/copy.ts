import { formatLocalDate } from './display.js';
import type { MeResponse } from './dto.js';

/**
 * Wording used on more than one screen. One name per action, the same on the web and on the phone, so the same
 * operation is never called two things.
 */
export const ACTIONS = {
  logIn: 'Log In',
  createAccount: 'Create Account',
  forgotPassword: 'Forgot Password?',
  verifyEmail: 'Verify Email',
  resendCode: 'Resend Code',
  createPassword: 'Create Password',
  publishSignal: 'Publish Signal',
  activateTrade: 'Activate Trade',
  updateStopLoss: 'Update Stop-Loss',
  closeTrade: 'Close Trade',
  editLevelsManually: 'Edit Levels Manually',
  startSubscription: 'Start Subscription',
  renewSubscription: 'Renew Subscription',
  grantFreeTrial: 'Grant Free Trial',
  enquireSubscription: 'Enquire About Subscription',
  enquireRenewal: 'Enquire About Renewal',
  sendEnquiry: 'Send Subscription Enquiry to Support',
  emailSupportInstead: 'Email Support Instead',
  contactSupport: 'Contact Support',
  doLater: "I'll do this later",
  exploreSignals: 'Explore Signals',
  generateTemporaryPassword: 'Generate Temporary Password',
  markCompleted: 'Mark Completed',
  updateEnquiryStatus: 'Update Enquiry Status',
  suspendAccount: 'Suspend Account',
} as const;

export const TITLES = {
  passwordResetRequested: 'Password Reset Requested',
  accountCreated: 'Account Created Successfully',
  newRegistrations: 'New Registrations',
  passwordResetRequests: 'Password Reset Requests',
  upcoming: 'Upcoming',
  active: 'Active',
  history: 'History',
} as const;

export type StatusTone = 'neutral' | 'pending' | 'ended';

export interface SubscriberStatusCopy {
  key: 'NONE' | 'ENQUIRY_STARTED' | 'UNDER_DISCUSSION' | 'EXPIRED' | 'TRIAL_ENDED' | 'SCHEDULED' | 'DISABLED';
  title: string;
  body: string;
  /** The one obvious next step. Null when there is nothing the person can do here. */
  primary: { label: string; purpose: 'SUBSCRIPTION' | 'RENEWAL'; kind: 'ENQUIRE' | 'CONTACT' } | null;
  /** Offered beside the primary action, never instead of it. */
  secondary: { label: string; kind: 'CONTACT' } | null;
  tone: StatusTone;
}

/**
 * What a signed-in person without access sees instead of signals. Identity, enquiry progress and access are
 * separate facts; this turns them into one short message and one action.
 */
export function subscriberStatus(me: MeResponse): SubscriberStatusCopy | null {
  if (me.access.allowed || me.role === 'ADMIN') return null;
  switch (me.access.reason) {
    case 'ACCOUNT_DISABLED':
      return {
        key: 'DISABLED',
        title: 'Account paused',
        body: 'Contact support to restore access.',
        primary: { label: ACTIONS.contactSupport, purpose: 'SUBSCRIPTION', kind: 'CONTACT' },
        secondary: null,
        tone: 'ended',
      };
    case 'SUBSCRIPTION_SCHEDULED':
      return {
        key: 'SCHEDULED',
        title: 'Starting soon',
        body: me.subscription.startsAt
          ? `Your access starts on ${new Date(me.subscription.startsAt).toLocaleDateString(undefined, { dateStyle: 'long' })}.`
          : 'Your access starts soon.',
        primary: null,
        secondary: { label: ACTIONS.contactSupport, kind: 'CONTACT' },
        tone: 'pending',
      };
    case 'SUBSCRIPTION_EXPIRED': {
      const trial = me.subscription.kind === 'TRIAL';
      const last = me.subscription.lastValidDate ? formatLocalDate(me.subscription.lastValidDate) : null;
      return {
        key: trial ? 'TRIAL_ENDED' : 'EXPIRED',
        title: trial ? 'Your Free Trial Has Ended' : 'Your Subscription Has Expired',
        body: `${last ? `Access ended after ${last}. ` : ''}Renew your subscription to continue receiving new trading signals.`,
        primary: { label: ACTIONS.enquireRenewal, purpose: 'RENEWAL', kind: 'ENQUIRE' },
        secondary: { label: ACTIONS.contactSupport, kind: 'CONTACT' },
        tone: 'ended',
      };
    }
    default:
      switch (me.enquiryStatus) {
        case 'INITIATED':
          return {
            key: 'ENQUIRY_STARTED',
            title: 'Enquiry Started',
            body: 'Your account is ready. Contact our support team to complete your subscription.',
            primary: { label: ACTIONS.contactSupport, purpose: 'SUBSCRIPTION', kind: 'ENQUIRE' },
            secondary: null,
            tone: 'pending',
          };
        case 'UNDER_DISCUSSION':
          return {
            key: 'UNDER_DISCUSSION',
            title: 'Subscription Under Discussion',
            body: 'Our team is reviewing your subscription enquiry.',
            primary: { label: ACTIONS.contactSupport, purpose: 'SUBSCRIPTION', kind: 'ENQUIRE' },
            secondary: null,
            tone: 'pending',
          };
        default:
          return {
            key: 'NONE',
            title: 'No Active Subscription',
            body: 'Activate a subscription to start receiving trading signals.',
            primary: { label: ACTIONS.enquireSubscription, purpose: 'SUBSCRIPTION', kind: 'ENQUIRE' },
            secondary: null,
            tone: 'neutral',
          };
      }
  }
}

/** The trial welcome. Every number comes from the grant itself. */
export function trialGreetingCopy(grant: { durationDays: number; lastValidDate: string }) {
  return {
    eyebrow: 'Congratulations!',
    title: `You've received a ${grant.durationDays}-Day Free Trial`,
    body: `Your access is now active until ${formatLocalDate(grant.lastValidDate)}.`,
    action: ACTIONS.exploreSignals,
  };
}
