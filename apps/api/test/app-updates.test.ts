import { createHash, randomBytes, verify } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ctx } from './helpers.js';

/*
 * Over-the-air app updates, as the app's update library sees them (Expo Updates protocol 1): a signed manifest for
 * the newest update of the runtime the phone reports, 204 when there is nothing new, and files that match the
 * hashes inside the signed manifest.
 */

const RUNTIME = `fp${randomBytes(6).toString('hex')}`;
const manifestUrl = () => `${ctx().api}/app-updates/manifest`;

interface Exported {
  folder: string;
  bundle: Buffer;
  image: Buffer;
  config: Record<string, unknown>;
}

/** Writes what `expo export` and scripts/export-update.mjs produce, as the publish step would. */
function publishUpdate(folder: string, runtime = RUNTIME, extra: { rollback?: boolean } = {}): Exported {
  const dir = join(ctx().updatesDir, 'android', runtime, folder);
  const bundle = Buffer.from(`console.log(${JSON.stringify(folder)});`);
  const image = randomBytes(64);
  const bundlePath = `_expo/static/js/android/entry-${createHash('md5').update(bundle).digest('hex')}.hbc`;
  const imagePath = `assets/${createHash('md5').update(image).digest('hex')}`;
  mkdirSync(join(dir, '_expo/static/js/android'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, bundlePath), bundle);
  writeFileSync(join(dir, imagePath), image);
  const config = { name: 'SignalDesk Preview', version: '1.0.0', extra: { variant: 'preview', androidPush: true } };
  writeFileSync(join(dir, 'expoConfig.json'), JSON.stringify(config));
  writeFileSync(
    join(dir, 'metadata.json'),
    JSON.stringify({
      version: 0,
      bundler: 'metro',
      fileMetadata: { android: { bundle: bundlePath, assets: [{ path: imagePath, ext: 'png' }] } },
    }),
  );
  if (extra.rollback) writeFileSync(join(dir, 'rollback'), '');
  return { folder, bundle, image, config };
}

function check(headers: Record<string, string> = {}) {
  return fetch(manifestUrl(), {
    headers: {
      accept: 'multipart/mixed,application/expo+json,application/json',
      'expo-protocol-version': '1',
      'expo-platform': 'android',
      'expo-runtime-version': RUNTIME,
      'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"',
      ...headers,
    },
  });
}

interface Part {
  name: string;
  headers: Record<string, string>;
  body: string;
}

async function parts(res: Response): Promise<Part[]> {
  const type = res.headers.get('content-type') ?? '';
  const boundary = /boundary=([^;]+)/.exec(type)?.[1];
  expect(type.startsWith('multipart/mixed')).toBe(true);
  const text = await res.text();
  return text
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((chunk) => {
      const [head = '', ...rest] = chunk.replace(/^\r\n/, '').split('\r\n\r\n');
      const headers = Object.fromEntries(
        head.split('\r\n').map((line) => {
          const at = line.indexOf(':');
          return [line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()];
        }),
      );
      const name = /name="([^"]+)"/.exec(headers['content-disposition'] ?? '')?.[1] ?? '';
      return { name, headers, body: rest.join('\r\n\r\n').replace(/\r\n$/, '') };
    });
}

/** What expo-updates does with the expo-signature header: RSA-SHA256 over the exact part body. */
function signatureValid(part: Part): boolean {
  const header = part.headers['expo-signature'] ?? '';
  expect(header).toMatch(/keyid="main"/);
  expect(header).toMatch(/alg="rsa-v1_5-sha256"/);
  const sig = /sig="([^"]+)"/.exec(header)?.[1] ?? '';
  return verify('sha256', Buffer.from(part.body, 'utf8'), ctx().updatesPublicKey, Buffer.from(sig, 'base64'));
}

async function manifestOf(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get('expo-protocol-version')).toBe('1');
  const [part] = await parts(res);
  expect(part?.name).toBe('manifest');
  expect(signatureValid(part as Part)).toBe(true);
  return JSON.parse((part as Part).body) as {
    id: string;
    createdAt: string;
    runtimeVersion: string;
    launchAsset: { hash: string; key: string; url: string; contentType: string; fileExtension: string };
    assets: { hash: string; key: string; url: string; contentType: string; fileExtension: string }[];
    extra: { expoClient: Record<string, unknown> };
  };
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('base64url');

describe('app update checks', () => {
  it('say there is nothing new before anything is published, and refuse malformed requests', async () => {
    const res = await check();
    expect(res.status).toBe(204);
    expect(res.headers.get('expo-protocol-version')).toBe('1');
    expect((await check({ 'expo-platform': 'windows' })).status).toBe(400);
    expect((await check({ 'expo-runtime-version': '../../etc' })).status).toBe(400);
    expect((await check({ 'expo-platform': 'ios' })).status).toBe(204);
  });

  it('serve the newest update, signed, with files matching the signed hashes', async () => {
    const first = publishUpdate('20261115T100000Z');
    const manifest = await manifestOf(await check());
    expect(manifest.runtimeVersion).toBe(RUNTIME);
    expect(manifest.createdAt).toBe('2026-11-15T10:00:00.000Z');
    expect(manifest.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(manifest.extra.expoClient).toEqual(first.config);

    // The app resolves file addresses against the manifest's own address, as a browser would.
    const bundle = await fetch(new URL(manifest.launchAsset.url, manifestUrl()));
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get('content-type')).toContain('application/javascript');
    expect(bundle.headers.get('cache-control')).toContain('immutable');
    const bundleBytes = Buffer.from(await bundle.arrayBuffer());
    expect(bundleBytes.equals(first.bundle)).toBe(true);
    expect(manifest.launchAsset.hash).toBe(sha256(bundleBytes));
    expect(manifest.launchAsset.fileExtension).toBe('.bundle');

    const [asset] = manifest.assets;
    expect(asset?.fileExtension).toBe('.png');
    const image = await fetch(new URL(asset?.url ?? '', manifestUrl()));
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(sha256(Buffer.from(await image.arrayBuffer()))).toBe(asset?.hash);

    // A phone already running it is told there is nothing new.
    expect((await check({ 'expo-current-update-id': manifest.id })).status).toBe(204);

    // A newer one replaces it; the older files stay available for a phone still downloading them.
    publishUpdate('20261115T120000Z');
    const second = await manifestOf(await check({ 'expo-current-update-id': manifest.id }));
    expect(second.id).not.toBe(manifest.id);
    expect(second.createdAt).toBe('2026-11-15T12:00:00.000Z');
    expect((await fetch(new URL(manifest.launchAsset.url, manifestUrl()))).status).toBe(200);
  });

  it('reach only APKs with the same native parts', async () => {
    const other = `fp${randomBytes(6).toString('hex')}`;
    publishUpdate('20261115T130000Z', other);
    expect((await check({ 'expo-runtime-version': `fp${randomBytes(6).toString('hex')}` })).status).toBe(204);
    const manifest = await manifestOf(await check({ 'expo-runtime-version': other }));
    expect(manifest.runtimeVersion).toBe(other);
  });

  it('ignore a folder still being copied, and files nobody published', async () => {
    const runtime = `fp${randomBytes(6).toString('hex')}`;
    publishUpdate('.incoming-20261115T140000Z', runtime);
    expect((await check({ 'expo-runtime-version': runtime })).status).toBe(204);

    const manifest = await manifestOf(await check());
    const base = new URL(manifest.launchAsset.url, manifestUrl());
    expect((await fetch(new URL(`${'0'.repeat(32)}`, base))).status).toBe(404);
    expect((await fetch(new URL('..%2F..%2Fmetadata.json', base))).status).toBe(404);
    expect(
      (await fetch(`${ctx().api}/app-updates/files/android/${RUNTIME}/latest/${manifest.launchAsset.key}`)).status,
    ).toBe(404);
  });

  it('can tell phones to go back to the code inside their APK', async () => {
    const runtime = `fp${randomBytes(6).toString('hex')}`;
    publishUpdate('20261115T150000Z', runtime);
    publishUpdate('20261115T160000Z', runtime, { rollback: true });
    const res = await check({ 'expo-runtime-version': runtime });
    expect(res.status).toBe(200);
    const [part] = await parts(res);
    expect(part?.name).toBe('directive');
    expect(signatureValid(part as Part)).toBe(true);
    expect(JSON.parse((part as Part).body)).toEqual({
      type: 'rollBackToEmbedded',
      parameters: { commitTime: '2026-11-15T16:00:00.000Z' },
    });
  });

  it('a signature does not survive any change to what was signed', async () => {
    const [part] = await parts(await check());
    expect(
      signatureValid({ ...(part as Part), body: (part as Part).body.replace('"runtimeVersion"', '"runtimeversion"') }),
    ).toBe(false);
  });
});
