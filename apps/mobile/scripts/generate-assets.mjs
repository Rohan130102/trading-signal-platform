// Draws the app icon, adaptive icon, splash mark and notification icon, so they need no design tool and no
// image library. Run with: npm run assets -w @signaldesk/mobile
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size);
      const at = row + 1 + x * 4;
      raw[at] = Math.round(r);
      raw[at + 1] = Math.round(g);
      raw[at + 2] = Math.round(b);
      raw[at + 3] = Math.round(a * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const segment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

// A rising signal line ending in an arrowhead, in a unit square centred on 0.5.
const LINE = [
  [0.2, 0.68],
  [0.41, 0.47],
  [0.55, 0.59],
  [0.8, 0.32],
];
const HEAD = [
  [0.8, 0.32],
  [0.62, 0.32],
  [0.8, 0.32],
  [0.8, 0.5],
];
function markDistance(x, y) {
  let d = Infinity;
  for (let i = 0; i < LINE.length - 1; i += 1) {
    d = Math.min(d, segment(x, y, LINE[i][0], LINE[i][1], LINE[i + 1][0], LINE[i + 1][1]));
  }
  d = Math.min(d, segment(x, y, HEAD[0][0], HEAD[0][1], HEAD[1][0], HEAD[1][1]));
  d = Math.min(d, segment(x, y, HEAD[2][0], HEAD[2][1], HEAD[3][0], HEAD[3][1]));
  return d;
}
const coverage = (distance, edge, soft) => Math.max(0, Math.min(1, (edge - distance) / soft + 0.5));
const scaled = (x, y, scale) => [(x - 0.5) / scale + 0.5, (y - 0.5) / scale + 0.5];
const THICKNESS = 0.052;
const BG = [11, 13, 16];
const ACCENT = [90, 169, 255];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function write(name, size, pixel) {
  writeFileSync(join(out, name), png(size, pixel));
  console.warn(`wrote assets/${name}`);
}

// Full-bleed square: stores apply their own rounding.
write('icon.png', 1024, (x, y) => {
  const glow = Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.48) / 0.72) * 0.16;
  const base = mix(BG, ACCENT, glow);
  const [mx, my] = scaled(x, y, 0.92);
  return [...mix(base, ACCENT, coverage(markDistance(mx, my), THICKNESS, 0.002)), 1];
});

// Android crops to the inner two thirds, so the mark stays inside that safe zone.
write('adaptive-icon.png', 1024, (x, y) => {
  const [mx, my] = scaled(x, y, 0.56);
  return [...ACCENT, coverage(markDistance(mx, my), THICKNESS, 0.004)];
});
write('adaptive-icon-mono.png', 1024, (x, y) => {
  const [mx, my] = scaled(x, y, 0.56);
  return [255, 255, 255, coverage(markDistance(mx, my), THICKNESS, 0.004)];
});
write('splash.png', 512, (x, y) => [...ACCENT, coverage(markDistance(x, y), THICKNESS, 0.004)]);

// Android draws this as a white silhouette in the status bar.
write('notification-icon.png', 96, (x, y) => {
  const [mx, my] = scaled(x, y, 1.1);
  return [255, 255, 255, coverage(markDistance(mx, my), THICKNESS * 1.25, 0.02)];
});
