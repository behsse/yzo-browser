// Thin, rounded scrollbars on web pages, like Arc's: no track, a thumb that is dark on light pages and
// light on dark ones. They are injected as a *user* style sheet, which the CSS cascade ranks below the
// site's own styles: a site that styles its scrollbars (::-webkit-scrollbar, scrollbar-color,
// scrollbar-width) keeps its own.

/**
 * Scrollbar style for a page background.
 * @param {boolean} dark Whether the page is dark.
 * @returns {string} CSS.
 */
function scrollbarCss(dark) {
  const thumb = dark ? "rgba(255, 255, 255, 0.32)" : "rgba(0, 0, 0, 0.32)";
  const hover = dark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)";
  return `
::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb {
  min-height: 40px;
  border: 2px solid transparent;
  border-radius: 10px;
  background-clip: padding-box;
  background-color: ${thumb};
}
::-webkit-scrollbar-thumb:hover { background-color: ${hover}; }
::-webkit-scrollbar-button { display: none; }
`;
}

/**
 * Runs in the page: whether its background is dark. Reads the first opaque background of <html> then
 * <body>; a page with none is white, like a browser's default.
 */
const READ_DARKNESS = `(() => {
  const parse = (value) => (value.match(/[\\d.]+/g) || []).map(Number);
  for (const element of [document.documentElement, document.body]) {
    if (!element) continue;
    const [r, g, b, a = 1] = parse(getComputedStyle(element).backgroundColor);
    if (a < 0.5 || r === undefined) continue;
    const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.4;
  }
  return false;
})()`;

/**
 * Keeps a page's scrollbars styled: on each load, reads whether the page is dark and (re)injects the
 * matching style sheet.
 * @param {Electron.WebContents} contents Tab page.
 */
function styleScrollbars(contents) {
  /** @type {string | null} */
  let key = null;
  let dark = null;

  const apply = async () => {
    if (contents.isDestroyed()) return;
    let isDark = false;
    try {
      isDark = Boolean(await contents.executeJavaScript(READ_DARKNESS, true));
    } catch {
      // Page gone or not scriptable (error page): light scrollbars.
    }
    if (contents.isDestroyed() || (key && isDark === dark)) return;
    const previous = key;
    key = await contents.insertCSS(scrollbarCss(isDark), { cssOrigin: "user" }).catch(() => null);
    dark = isDark;
    if (previous) contents.removeInsertedCSS(previous).catch(() => {});
  };

  // A new document starts without the sheet; its background is known once it is parsed and again once
  // loaded (late styles).
  contents.on("did-navigate", () => {
    key = null;
    dark = null;
  });
  contents.on("dom-ready", () => void apply());
  contents.on("did-stop-loading", () => void apply());
}

module.exports = { styleScrollbars, scrollbarCss };
