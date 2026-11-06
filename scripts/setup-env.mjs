// Creates a local .env with fresh secrets. Refuses to overwrite one that already exists.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import webpush from 'web-push';

if (existsSync('.env')) {
  console.log('.env already exists. Nothing changed.');
  process.exit(0);
}
const keys = webpush.generateVAPIDKeys();
const content = readFileSync('.env.example', 'utf8')
  .replace('APP_ENCRYPTION_KEY=', `APP_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`)
  .replace('PUSH_TRANSPORT=disabled', 'PUSH_TRANSPORT=webpush')
  .replace('VAPID_PUBLIC_KEY=', `VAPID_PUBLIC_KEY=${keys.publicKey}`)
  .replace('VAPID_PRIVATE_KEY=', `VAPID_PRIVATE_KEY=${keys.privateKey}`);
writeFileSync('.env', content, { mode: 0o600 });
console.log('.env created with fresh secrets.');
