import { env } from '../config/env.js';

type Level = 'info' | 'warn' | 'error';

/** One JSON object per line. Callers pass identifiers, never credentials or message bodies. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, instance: env.INSTANCE_ID, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else process.stdout.write(`${line}\n`);
}
