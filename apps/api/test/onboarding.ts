import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, ctx, waitUntil } from './helpers.js';

/** Helpers for sign-up and recovery. Emails come from the API's file transport, exactly as it would send them. */

export interface SentMail {
  messageId: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}

export function mailbox(address: string): SentMail[] {
  const dir = ctx().mailDir;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as SentMail)
    .filter((m) => m.to.toLowerCase() === address.toLowerCase());
}

export function codeIn(mail: SentMail | undefined): string {
  const match = mail?.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`No code in ${JSON.stringify(mail)}`);
  return match[1] as string;
}

export async function latestCode(address: string, after = 0): Promise<string> {
  const mail = await waitUntil(() => mailbox(address).slice(after).at(-1));
  return codeIn(mail);
}

let counter = 0;
export function uniqueEmail(prefix = 'asha'): string {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}.${counter}@example.test`;
}

export function details(email: string, overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Asha',
    lastName: 'Rao',
    email,
    mobile: '98765 43210',
    age: 29,
    consent: true,
    ...overrides,
  };
}

export const NEW_PASSWORD = 'a long and private phrase';

/** The whole sign-up, as a person would do it. Returns a signed-in client. */
export async function signUp(email = uniqueEmail(), overrides: Record<string, unknown> = {}) {
  const client = new Client();
  const started = await client.post('/auth/register', details(email, overrides));
  if (started.status !== 200) throw new Error(`register failed: ${JSON.stringify(started.body)}`);
  const verified = await client.post('/auth/register/verify', {
    challengeId: started.body.challengeId,
    code: await latestCode(email),
  });
  if (verified.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verified.body)}`);
  const completed = await client.post('/auth/register/complete', {
    setupToken: verified.body.setupToken,
    password: NEW_PASSWORD,
  });
  if (completed.status !== 200) throw new Error(`complete failed: ${JSON.stringify(completed.body)}`);
  const me = await client.get('/auth/me');
  return { client, email, id: me.body.id as string };
}
