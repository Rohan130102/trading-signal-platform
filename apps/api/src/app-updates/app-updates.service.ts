import { createHash, createPrivateKey, type KeyObject, sign } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { log } from '../common/log.js';
import { env } from '../config/env.js';

/**
 * Over-the-air updates for the native app: new screens and wording without a new APK. Implements version 1 of the
 * Expo Updates protocol (https://docs.expo.dev/technical-specs/expo-updates-1/).
 *
 * Each update is the output of `expo export`, published to its own folder:
 *   <APP_UPDATES_DIR>/<platform>/<runtime version>/<UTC time, e.g. 20261115T180000Z>/
 * The newest folder for the runtime version the app reports is the current update. A file named `rollback` in it
 * tells phones to return to the code inside their APK. Folders are published under another name and renamed into
 * place, so a half-copied update is never served.
 *
 * Every answer is signed with the private key whose certificate is built into the app, so a phone runs only code
 * this server published; the files are checked against hashes inside the signed manifest.
 */

const PLATFORMS = new Set(['android', 'ios']);
/** What expo-updates sends: an app version or a fingerprint hash. */
const RUNTIME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UPDATE = /^\d{8}T\d{6}Z$/;
const KEY = /^[0-9a-f]{32}$/;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,199}$/;

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: 'application/json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
};

export class BadUpdateRequest extends Error {}

interface ExportMetadata {
  fileMetadata?: Record<string, { bundle?: string; assets?: { path: string; ext: string }[] } | undefined>;
}

interface ManifestAsset {
  hash: string;
  key: string;
  fileExtension: string;
  contentType: string;
  url: string;
}

export interface SignedPart {
  /** "manifest" for an update, "directive" for an instruction such as rolling back. */
  name: 'manifest' | 'directive';
  body: string;
  /** The expo-signature header value. */
  signature: string;
}

interface Published {
  id: string;
  part: SignedPart;
  files: Map<string, { path: string; contentType: string }>;
}

/** The update ID is a UUID made from the hash of the export's metadata, so the same export always has the same ID. */
export function uuidFromHash(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 20261115T180000Z → 2026-11-15T18:00:00.000Z */
export function publishedAt(folder: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(folder);
  if (!m) throw new Error(`Not an update folder name: ${folder}`);
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
}

@Injectable()
export class AppUpdatesService {
  private readonly root = env.APP_UPDATES_DIR ? resolve(env.APP_UPDATES_DIR) : null;
  private readonly key: KeyObject | null = env.APP_UPDATES_SIGNING_KEY
    ? createPrivateKey(Buffer.from(env.APP_UPDATES_SIGNING_KEY, 'base64'))
    : null;
  /** Published updates never change, so each is read and hashed once. */
  private readonly cache = new Map<string, Published>();

  get enabled(): boolean {
    return Boolean(this.root && this.key);
  }

  /**
   * What a phone should do: nothing (null), download this update, or roll back to its APK's own code.
   * `currentUpdateId` is the update the phone is running; when it is already the newest, there is nothing to send.
   */
  async check(platform: string, runtimeVersion: string, currentUpdateId: string | null): Promise<SignedPart | null> {
    if (!PLATFORMS.has(platform)) throw new BadUpdateRequest('Unknown platform');
    if (!RUNTIME.test(runtimeVersion)) throw new BadUpdateRequest('Invalid runtime version');
    if (!this.root || !this.key) return null;
    const folder = await this.newest(platform, runtimeVersion);
    if (!folder) return null;
    const dir = join(this.root, platform, runtimeVersion, folder);
    if (await exists(join(dir, 'rollback'))) {
      return this.signed('directive', { type: 'rollBackToEmbedded', parameters: { commitTime: publishedAt(folder) } });
    }
    const update = await this.load(platform, runtimeVersion, folder);
    if (!update || update.id === currentUpdateId) return null;
    return update.part;
  }

  /** One file of a published update, by the key its manifest gave it. */
  async file(
    platform: string,
    runtimeVersion: string,
    folder: string,
    key: string,
  ): Promise<{ path: string; contentType: string } | null> {
    if (!PLATFORMS.has(platform) || !RUNTIME.test(runtimeVersion) || !UPDATE.test(folder) || !KEY.test(key)) {
      return null;
    }
    const update = await this.load(platform, runtimeVersion, folder);
    return update?.files.get(key) ?? null;
  }

  private async newest(platform: string, runtimeVersion: string): Promise<string | null> {
    try {
      const entries = await readdir(join(this.root as string, platform, runtimeVersion), { withFileTypes: true });
      const folders = entries.filter((e) => e.isDirectory() && UPDATE.test(e.name)).map((e) => e.name);
      return folders.sort().at(-1) ?? null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async load(platform: string, runtimeVersion: string, folder: string): Promise<Published | null> {
    const cacheKey = `${platform}/${runtimeVersion}/${folder}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    if (!this.root || !this.key) return null;
    const dir = join(this.root, platform, runtimeVersion, folder);
    let raw: Buffer;
    try {
      raw = await readFile(join(dir, 'metadata.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const metadata = JSON.parse(raw.toString('utf8')) as ExportMetadata;
    const exported = metadata.fileMetadata?.[platform];
    if (!exported?.bundle) {
      log('warn', 'app_update_without_bundle', { platform, runtimeVersion, folder });
      return null;
    }
    const expoClient = JSON.parse(await readFile(join(dir, 'expoConfig.json'), 'utf8')) as unknown;

    const files = new Map<string, { path: string; contentType: string }>();
    const describe = async (relative: string, ext: string | null): Promise<ManifestAsset> => {
      const segments = relative.split('/');
      if (!segments.every((s) => SEGMENT.test(s))) throw new Error(`Unexpected file name in update: ${relative}`);
      const path = join(dir, ...segments);
      if (!path.startsWith(dir + sep)) throw new Error(`File outside the update: ${relative}`);
      const content = await readFile(path);
      const key = createHash('md5').update(content).digest('hex');
      const contentType = ext === null ? 'application/javascript' : (CONTENT_TYPES[ext] ?? 'application/octet-stream');
      files.set(key, { path, contentType });
      return {
        hash: createHash('sha256').update(content).digest('base64url'),
        key,
        fileExtension: ext === null ? '.bundle' : `.${ext}`,
        contentType,
        // Relative to the manifest's address, so it works behind any proxy or domain.
        url: `files/${platform}/${runtimeVersion}/${folder}/${key}`,
      };
    };

    const manifest = {
      id: uuidFromHash(createHash('sha256').update(raw).digest('hex')),
      createdAt: publishedAt(folder),
      runtimeVersion,
      launchAsset: await describe(exported.bundle, null),
      assets: await Promise.all((exported.assets ?? []).map((a) => describe(a.path, a.ext))),
      metadata: {},
      extra: { expoClient },
    };
    const published: Published = { id: manifest.id, part: this.signed('manifest', manifest), files };
    this.cache.set(cacheKey, published);
    return published;
  }

  private signed(name: SignedPart['name'], value: unknown): SignedPart {
    const body = JSON.stringify(value);
    const sig = sign('sha256', Buffer.from(body, 'utf8'), this.key as KeyObject).toString('base64');
    return { name, body, signature: `sig="${sig}", keyid="main", alg="rsa-v1_5-sha256"` };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
