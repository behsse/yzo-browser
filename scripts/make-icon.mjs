// Generates build/icon.png (1024×1024), the app icon: the Yzo logo in white on a rounded gradient
// square. The logo outline is read from src/ui/Icon.tsx (BRAND_PATH), so the app icon and the top bar
// always match. electron-builder derives the Windows .ico and macOS .icns from it.
// Pure Node (zlib PNG encoder), no image library needed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 1024;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

/** Logo size in the icon, as a share of the canvas (the square spans 72–952 px). */
const LOGO_SHARE = 0.6;
/** Vertical sub-samples per pixel row for anti-aliasing. */
const SUBROWS = 4;

/**
 * Flattens an absolute "M x y C … Z" path (BRAND_PATH, 100-unit square) into a polygon in icon pixels.
 * @param {string} d Path data.
 * @returns {[number, number][]} Polygon vertices.
 */
function flattenPath(d) {
  const numbers = d.match(/-?\d*\.?\d+/g).map(Number);
  const scale = (SIZE * LOGO_SHARE) / 100;
  const offset = (SIZE - 100 * scale) / 2;
  const at = (i) => [offset + numbers[i] * scale, offset + numbers[i + 1] * scale];
  let current = at(0);
  const points = [current];
  for (let i = 2; i + 5 < numbers.length; i += 6) {
    const [c1, c2, end] = [at(i), at(i + 2), at(i + 4)];
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      points.push([0, 1].map((a) => u * u * u * current[a] + 3 * u * u * t * c1[a] + 3 * u * t * t * c2[a] + t * t * t * end[a]));
    }
    current = end;
  }
  return points;
}

/**
 * Rasterizes a polygon into per-pixel coverage (0–1), even-odd rule, anti-aliased with sub-rows and
 * exact horizontal span overlap.
 * @param {[number, number][]} polygon Vertices in pixels.
 * @returns {Float32Array} Coverage, SIZE × SIZE.
 */
function rasterize(polygon) {
  const coverage = new Float32Array(SIZE * SIZE);
  for (let sub = 0; sub < SIZE * SUBROWS; sub++) {
    const y = (sub + 0.5) / SUBROWS;
    const row = Math.floor(sub / SUBROWS);
    const crossings = [];
    for (let i = 0; i < polygon.length; i++) {
      const [x0, y0] = polygon[i];
      const [x1, y1] = polygon[(i + 1) % polygon.length];
      if (y0 <= y !== y1 <= y) crossings.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const [from, to] = [Math.max(0, crossings[i]), Math.min(SIZE, crossings[i + 1])];
      for (let x = Math.floor(from); x < Math.ceil(to); x++) {
        coverage[row * SIZE + x] += (Math.min(to, x + 1) - Math.max(from, x)) / SUBROWS;
      }
    }
  }
  return coverage;
}

const brandPath = readFileSync(join(root, "src", "ui", "Icon.tsx"), "utf8").match(/const BRAND_PATH =\s*"([^"]+)"/)[1];
const logo = rasterize(flattenPath(brandPath));

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
    const ink = Math.min(1, logo[y * SIZE + x]);
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
