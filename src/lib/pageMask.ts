import type { ViewBounds } from "../env";

/** Corner radius of the native page views (VIEW_RADIUS in electron/views.cjs). */
const VIEW_RADIUS = 10;

/**
 * Builds the mask of the app backdrop: the whole window minus a hole per page view, so the backdrop
 * never paints over a page when the UI is stacked above the pages. Holes are rounded like the pages;
 * a split pane's hole has square top corners, so the native views in its bar's color (under the page,
 * see electron/views.cjs) show in the page's rounded top corners instead of the backdrop.
 * @param holes Page rectangles in window coordinates, `squareTop` for split panes.
 * @param width Window width in CSS pixels.
 * @param height Window height in CSS pixels.
 * @returns CSS url() of an SVG mask.
 */
export function pageHolesMask(holes: (ViewBounds & { squareTop?: boolean })[], width: number, height: number): string {
  const r = VIEW_RADIUS;
  const cutouts = holes
    .map(({ x, y, width: w, height: h, squareTop }) =>
      squareTop
        ? `M${x} ${y}h${w}v${h - r}a${r} ${r} 0 0 1 -${r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 -${r} -${r}z`
        : `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 -${r} -${r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} -${r}z`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill-rule="evenodd" d="M0 0H${width}V${height}H0z${cutouts}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
