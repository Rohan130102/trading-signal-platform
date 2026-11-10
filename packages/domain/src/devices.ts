import { z } from 'zod';
import type { Role } from './subscription.js';

/**
 * One app installation, one subscriber account.
 *
 * The app sends an installation identifier when it signs in. On Android it is derived from the
 * platform's per-app device identifier, which survives clearing the app's data and reinstalling; on
 * iPhone it is a random value kept in the Keychain, which survives reinstalling. Neither is a hardware
 * identity, and a modified app could send a different value: the binding stops casual account switching,
 * and stronger proof needs Play Integrity or App Attest. The decision is always made on the server.
 */

export const installationIdSchema = z
  .string()
  .trim()
  .min(16, 'Update the app to sign in')
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Update the app to sign in');

export type BindingDecision =
  /** No binding yet: this installation becomes this subscriber's. */
  | 'BIND'
  /** Already this subscriber's. */
  | 'ALLOW'
  /** Bound to someone else. Only an administrator can release it. */
  | 'BLOCK'
  /** Administrators are staff, not subscribers, and are never bound or blocked. */
  | 'EXEMPT';

export function decideDeviceBinding(input: {
  role: Role;
  userId: string;
  /** The user the installation is currently bound to, if any. Released bindings do not count. */
  boundUserId: string | null;
}): BindingDecision {
  if (input.role === 'ADMIN') return 'EXEMPT';
  if (input.boundUserId === null) return 'BIND';
  return input.boundUserId === input.userId ? 'ALLOW' : 'BLOCK';
}

export const DEVICE_BOUND_MESSAGE =
  'This phone is already registered to another account. Ask your administrator to release it, then sign in again.';
export const APP_UPDATE_REQUIRED_MESSAGE = 'Update SignalDesk to the latest version to sign in on this phone.';

export const releaseDeviceSchema = z.strictObject({
  reason: z.string().trim().min(3, 'Say why, for the audit log').max(300),
});

export interface DeviceBindingView {
  id: string;
  platform: string | null;
  deviceLabel: string | null;
  boundAt: string;
  lastSeenAt: string;
  releasedAt: string | null;
  releasedByName: string | null;
  releaseReason: string | null;
  /** Sessions currently signed in from this installation. */
  activeSessions: number;
}
