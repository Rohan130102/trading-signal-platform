// Drives the real app on a real Android emulator through adb and the system's own accessibility tree.
// It reads what is on screen and taps what a person would tap. No test hooks are compiled into the app.
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const ADB =
  process.env.ADB ?? join(process.env.ANDROID_HOME ?? join(homedir(), 'Library/Android/sdk'), 'platform-tools/adb');
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (value) =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#10;', '\n');

function parseNodes(xml) {
  const nodes = [];
  for (const match of xml.matchAll(/<node\b([^>]*)>?/g)) {
    const attrs = {};
    for (const a of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? '');
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nodes.push({
      text: attrs.text ?? '',
      desc: attrs['content-desc'] ?? '',
      id: attrs['resource-id'] ?? '',
      cls: attrs.class ?? '',
      clickable: attrs.clickable === 'true',
      checked: attrs.checked === 'true',
      enabled: attrs.enabled !== 'false',
      selected: attrs.selected === 'true',
      scrollable: attrs.scrollable === 'true',
      focused: attrs.focused === 'true',
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      x1,
      y1,
      x2,
      y2,
    });
  }
  return nodes;
}

const matches = (node, sel) => {
  if (sel.id !== undefined && node.id !== sel.id && !node.id.endsWith(`/${sel.id}`)) return false;
  if (sel.text !== undefined && !(sel.text instanceof RegExp ? sel.text.test(node.text) : node.text === sel.text))
    return false;
  if (sel.desc !== undefined && !(sel.desc instanceof RegExp ? sel.desc.test(node.desc) : node.desc === sel.desc))
    return false;
  if (sel.any !== undefined) {
    const re = sel.any instanceof RegExp ? sel.any : new RegExp(sel.any.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!re.test(node.text) && !re.test(node.desc) && !re.test(node.id)) return false;
  }
  return true;
};

const describe = (sel) => JSON.stringify(sel, (_k, v) => (v instanceof RegExp ? String(v) : v));

export class Device {
  constructor({ serial = 'emulator-5554', artifacts = join(here, 'artifacts') } = {}) {
    this.serial = serial;
    this.artifacts = artifacts;
    this.prefix = '';
    this.steps = [];
    mkdirSync(artifacts, { recursive: true });
  }

  async adb(...args) {
    const { stdout } = await run(ADB, ['-s', this.serial, ...args], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'buffer',
    });
    return stdout;
  }

  adbSync(...args) {
    return execFileSync(ADB, ['-s', this.serial, ...args]);
  }

  async shell(...args) {
    return (await this.adb('shell', ...args)).toString();
  }

  async nodes() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const out = (await this.adb('exec-out', 'uiautomator', 'dump', '/dev/tty')).toString();
      const start = out.indexOf('<?xml');
      const end = out.lastIndexOf('</hierarchy>');
      if (start !== -1 && end !== -1) return parseNodes(out.slice(start, end));
      await delay(300);
    }
    throw new Error('Could not read the screen');
  }

  async query(sel) {
    return (await this.nodes()).find((n) => matches(n, sel)) ?? null;
  }

  async waitFor(sel, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    let last = [];
    while (Date.now() < deadline) {
      last = await this.nodes();
      const node = last.find((n) => matches(n, sel));
      if (node) return node;
      await delay(250);
    }
    const visible = last
      .map((n) => n.text || n.desc || n.id.replace(/.*\//, ''))
      .filter(Boolean)
      .slice(0, 50)
      .join(' | ');
    await this.screenshot(`FAILED-${Date.now()}`).catch(() => undefined);
    throw new Error(`Timed out waiting for ${describe(sel)}. On screen: ${visible}`);
  }

  async waitGone(sel, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!(await this.query(sel))) return;
      await delay(250);
    }
    throw new Error(`Still on screen after ${timeout} ms: ${describe(sel)}`);
  }

  async tapAt(x, y) {
    await this.adb('shell', 'input', 'tap', String(x), String(y));
  }

  async tap(sel, timeout) {
    const node = await this.waitFor(sel, timeout);
    await this.tapAt(node.x, node.y);
    return node;
  }

  /** Scrolls until something appears. Lists draw lazily, so it may not exist in the tree yet. */
  async scrollTo(sel, { maxSwipes = 12, up = false } = {}) {
    for (let i = 0; i <= maxSwipes; i += 1) {
      const node = await this.query(sel);
      const size = await this.size();
      if (node && node.y2 > 0 && node.y1 < size.height - 160) return node;
      await this.swipe(up);
      await delay(350);
    }
    return this.waitFor(sel, 1000);
  }

  async swipe(up = false) {
    const { width, height } = await this.size();
    const from = Math.round(height * (up ? 0.3 : 0.72));
    const to = Math.round(height * (up ? 0.72 : 0.3));
    const x = Math.round(width / 2);
    await this.adb('shell', 'input', 'swipe', String(x), String(from), String(x), String(to), '300');
  }

  async size() {
    if (this.cachedSize) return this.cachedSize;
    const out = await this.shell('wm', 'size');
    const m = /Override size: (\d+)x(\d+)/.exec(out) ?? /Physical size: (\d+)x(\d+)/.exec(out);
    this.cachedSize = { width: Number(m[1]), height: Number(m[2]) };
    return this.cachedSize;
  }

  async setSize(width, height, density) {
    await this.shell('wm', 'size', `${width}x${height}`);
    await this.shell('wm', 'density', String(density));
    this.cachedSize = null;
    await delay(1200);
  }

  async resetSize() {
    await this.shell('wm', 'size', 'reset');
    await this.shell('wm', 'density', 'reset');
    this.cachedSize = null;
    await delay(800);
  }

  async type(sel, text, { clear = true } = {}) {
    const node = await this.tap(sel);
    await delay(250);
    if (clear) {
      await this.adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END');
      const length = (await this.query(sel))?.text?.length ?? node.text.length;
      if (length > 0) {
        const keys = Array.from({ length }, () => 'KEYCODE_DEL');
        await this.adb('shell', 'input', 'keyevent', ...keys);
      }
    }
    // `input text` splits on spaces and treats a few characters specially.
    const escaped = text.replace(/([\\"'`$&|;<>()*~#?![\]{}])/g, '\\$1').replace(/ /g, '%s');
    await this.adb('shell', 'input', 'text', `"${escaped}"`);
    await delay(150);
  }

  async hideKeyboard() {
    const out = await this.shell('dumpsys', 'input_method');
    if (/mInputShown=true/.test(out)) {
      await this.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      await delay(250);
    }
  }

  async back() {
    await this.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await delay(400);
  }

  async screenshot(name) {
    const png = await this.adb('exec-out', 'screencap', '-p');
    const dir = this.prefix ? join(this.artifacts, this.prefix) : this.artifacts;
    mkdirSync(dir, { recursive: true });
    const { writeFileSync } = await import('node:fs');
    const path = join(dir, `${name}.png`);
    writeFileSync(path, png);
    return path;
  }

  /** Every readable string on screen, for assertions about wording. */
  async text() {
    return (await this.nodes())
      .map((n) => [n.text, n.desc].filter(Boolean).join(' '))
      .filter(Boolean)
      .join('\n');
  }

  async has(sel) {
    return Boolean(await this.query(sel));
  }

  /** Nothing with a size below the platform's minimum should be tappable, and nothing should run off screen. */
  async audit(minDp = 40) {
    const nodes = await this.nodes();
    const { width } = await this.size();
    const out = await this.shell('wm', 'density');
    const density = Number(/Override density: (\d+)/.exec(out)?.[1] ?? /Physical density: (\d+)/.exec(out)?.[1] ?? 160);
    const scale = density / 160;
    const problems = [];
    // A row cut off by the edge of a scrolling list is not a small target.
    const scrollers = nodes.filter((n) => n.scrollable);
    const clipped = (n) =>
      scrollers.some(
        (s) =>
          n.x1 >= s.x1 - 1 &&
          n.x2 <= s.x2 + 1 &&
          (Math.abs(n.y2 - s.y2) <= 2 ||
            Math.abs(n.y1 - s.y1) <= 2 ||
            Math.abs(n.x2 - s.x2) <= 2 ||
            Math.abs(n.x1 - s.x1) <= 2),
      );
    for (const n of nodes) {
      if (n.clickable && n.enabled && !clipped(n)) {
        const w = (n.x2 - n.x1) / scale;
        const h = (n.y2 - n.y1) / scale;
        if ((w < minDp || h < minDp) && n.x1 >= 0 && n.y1 >= 0) {
          problems.push(`small target ${Math.round(w)}x${Math.round(h)}dp: ${n.text || n.desc || n.id}`);
        }
      }
      if ((n.text || n.desc) && n.x2 > width + 2 && !/ScrollView|HorizontalScrollView/.test(n.cls)) {
        problems.push(`runs off screen: ${n.text || n.desc}`);
      }
    }
    return problems;
  }
}
