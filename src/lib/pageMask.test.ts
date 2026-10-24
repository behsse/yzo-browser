import { describe, expect, it } from "vitest";
import { pageHolesMask } from "./pageMask";

/** Decodes the SVG inside the CSS url(). */
function svgOf(mask: string): string {
  return decodeURIComponent(mask.slice('url("data:image/svg+xml,'.length, -'")'.length));
}

describe("page holes mask", () => {
  it("covers the whole window when no page is shown", () => {
    const svg = svgOf(pageHolesMask([], 800, 600));
    expect(svg).toContain('width="800" height="600"');
    expect(svg).toContain('d="M0 0H800V600H0z"');
  });

  it("cuts one rounded hole per page, with the even-odd rule", () => {
    const svg = svgOf(pageHolesMask([{ x: 240, y: 6, width: 500, height: 400 }, { x: 10, y: 10, width: 100, height: 100 }], 800, 600));
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg.match(/M\d+ \d+h/g)).toEqual(["M250 6h", "M20 10h"]);
    expect(svg).toContain("h480a10 10 0 0 1 10 10v380");
  });
});
