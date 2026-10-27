// Background color of a page, read from the top rows of its pixels, so a split pane's bar can take
// the site's color like Arc. Chromium bitmaps are BGRA on desktop platforms.

/**
 * Most common color of a strip of pixels: colors are grouped coarsely so text and icons in a header
 * do not tint the result, then the biggest group is averaged.
 * @param {Buffer} bitmap BGRA pixels.
 * @returns {string | null} "#rrggbb", or null for an empty strip.
 */
function dominantColor(bitmap) {
  /** @type {Map<number, { count: number, r: number, g: number, b: number }>} */
  const groups = new Map();
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const b = bitmap[i];
    const g = bitmap[i + 1];
    const r = bitmap[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const group = groups.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    group.count += 1;
    group.r += r;
    group.g += g;
    group.b += b;
    groups.set(key, group);
  }
  let best = null;
  for (const group of groups.values()) if (!best || group.count > best.count) best = group;
  if (!best) return null;
  const hex = (sum) => Math.round(sum / best.count).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

module.exports = { dominantColor };
