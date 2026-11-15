#!/usr/bin/env node
/**
 * Packages the app's JavaScript and images as an over-the-air update for Android, ready to publish to the
 * server (docs/DEPLOYMENT.md, "App updates"). Run it in the same job and environment as the APK build:
 * APP_VARIANT, EXPO_PUBLIC_API_URL, EAS_PROJECT_ID and GOOGLE_SERVICES_FILE decide what the update contains,
 * and the runtime version (a fingerprint of everything native) decides which installed APKs may run it.
 *
 *   node scripts/export-update.mjs <output folder>
 *
 * Writes <output>/update/ (the `expo export` output plus expoConfig.json) and <output>/runtime-version.txt.
 * Contains nothing secret: the same code is inside every APK.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'dist-update');
const update = join(out, 'update');
const run = (args, options = {}) =>
  execFileSync('npx', args, { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', ...options });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

run(['expo', 'export', '--platform', 'android', '--output-dir', update], { stdio: 'inherit' });
// What the app reads as its configuration while running this update (Constants.expoConfig).
writeFileSync(join(update, 'expoConfig.json'), run(['expo', 'config', '--type', 'public', '--json']));
const { runtimeVersion } = JSON.parse(run(['expo-updates', 'runtimeversion:resolve', '--platform', 'android']));
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runtimeVersion ?? '')) {
  throw new Error(`Unexpected runtime version: ${runtimeVersion}`);
}
writeFileSync(join(out, 'runtime-version.txt'), `${runtimeVersion}\n`);

const metadata = JSON.parse(readFileSync(join(update, 'metadata.json'), 'utf8'));
const android = metadata.fileMetadata?.android;
if (!android?.bundle) throw new Error('The export has no Android bundle');
console.log(`Update ready for runtime ${runtimeVersion}: ${android.assets.length} files plus the bundle.`);
