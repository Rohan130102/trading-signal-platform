import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { env } from '../config/env.js';

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the hash of a session token is stored, so a database leak does not yield live sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const UNAMBIGUOUS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomGroup(length: number): string {
  return Array.from({ length }, () => UNAMBIGUOUS[randomInt(UNAMBIGUOUS.length)]).join('');
}

/** Easy to read out or paste into a message: no 0/O or 1/I/L. About 74 bits of entropy. */
export function newTemporaryPassword(): string {
  return `${randomGroup(5)}-${randomGroup(5)}-${randomGroup(5)}`;
}

export function newRecoveryCode(): string {
  return `${randomGroup(4)}-${randomGroup(4)}-${randomGroup(4)}`;
}

const key = () => Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(sealed: string): string {
  const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Malformed sealed secret');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
