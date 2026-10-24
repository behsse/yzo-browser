// Generates build/icon.png (1024×1024), the placeholder app icon: the stroked "y" brand mark on a
// rounded gradient square. electron-builder derives the Windows .ico and macOS .icns from it.
// Pure Node (zlib PNG encoder), no image library needed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 1024;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Distance from point p to segment ab.
 * @returns {number} Distance in pixels.
 */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Signed distance to a rounded square (negative inside).
 * @returns {number} Distance in pixels.
 */
function roundedSquare(px, py, inset, radius) {
  const half = SIZE / 2 - inset;
  const qx = Math.abs(px - SIZE / 2) - (half - radius);
  const qy = Math.abs(py - SIZE / 2) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

// The brand path "M7 6l5.33 8M17 6l-7 12" on a 24-unit grid, scaled into the icon.
const unit = 640 / 24;
const offset = (SIZE - 24 * unit) / 2;
const at = (x, y) => [offset + x * unit, offset + y * unit];
const strokes = [
  [...at(7, 6), ...at(12.33, 14)],
  [...at(17, 6), ...at(10, 18)],
];
const strokeHalfWidth = 1.15 * unit;

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    const shape = roundedSquare(x + 0.5, y + 0.5, 72, 200);
    const coverage = Math.max(0, Math.min(1, 0.5 - shape));
    if (coverage === 0) continue;
    // Diagonal gradient between the two default theme colors, deepened for contrast.
    const t = (x + y) / (2 * SIZE);
    let r = 88 + (126 - 88) * t;
    let g = 104 + (87 - 104) * t;
    let b = 214 + (194 - 214) * t;
    const d = Math.min(...strokes.map((s) => segmentDistance(x + 0.5, y + 0.5, ...s)));
    const ink = Math.max(0, Math.min(1, strokeHalfWidth - d + 0.5));
    r += (255 - r) * ink;
    g += (255 - g) * ink;
    b += (255 - b) * ink;
    raw[o] = Math.round(r);
    raw[o + 1] = Math.round(g);
    raw[o + 2] = Math.round(b);
    raw[o + 3] = Math.round(255 * coverage);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 6;

const out = join(root, "build", "icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
console.log("build/icon.png written");
