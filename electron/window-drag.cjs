// Native window move started from the UI, for the floating top bar. Electron drag regions do not work
// there (the UI view is stacked above the pages while it shows), so on Windows the press is handed to
// the system as if it were on the title bar: Windows then runs its own move loop, with snapping and
// restoring a maximized window by dragging, exactly like a real title bar.

const WM_SYSCOMMAND = 0x0112;
/** SC_MOVE | HTCAPTION: a move driven by the held mouse button, as from the title bar. */
const SC_DRAGMOVE = 0xf012;

/** @type {{ releaseCapture: () => boolean, postMessage: (hwnd: bigint, msg: number, wParam: number, lParam: number) => boolean } | null | undefined} */
let user32;

/**
 * Loads the two user32 functions the move needs, once. Windows only; null elsewhere or if loading fails.
 * @returns {typeof user32} Bound functions, or null.
 */
function loadUser32() {
  if (user32 !== undefined) return user32;
  user32 = null;
  if (process.platform !== "win32") return user32;
  try {
    const koffi = require("koffi");
    const lib = koffi.load("user32.dll");
    user32 = {
      releaseCapture: lib.func("bool __stdcall ReleaseCapture()"),
      postMessage: lib.func("bool __stdcall PostMessageW(uintptr_t hWnd, uint32_t Msg, uintptr_t wParam, intptr_t lParam)"),
    };
  } catch (error) {
    console.warn("[window-drag] native move unavailable:", error);
  }
  return user32;
}

/**
 * Packs screen coordinates into an LPARAM (MAKELPARAM, signed 16-bit halves for multi-screen setups).
 * @param {number} x Screen x.
 * @param {number} y Screen y.
 * @returns {number} LPARAM.
 */
function pointLParam(x, y) {
  return ((y & 0xffff) << 16) | (x & 0xffff);
}

/**
 * Starts the system move loop for the window, from the current cursor position, while the left button
 * is held (call it on press). Returns false where it is not supported, so the caller can fall back.
 * @param {import("electron").BaseWindow} win Window to move.
 * @param {{ x: number, y: number }} cursor Cursor position in physical screen pixels.
 * @returns {boolean} Whether the move was handed to the system.
 */
function startNativeWindowDrag(win, cursor) {
  const api = loadUser32();
  if (!api) return false;
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  api.releaseCapture();
  return api.postMessage(hwnd, WM_SYSCOMMAND, SC_DRAGMOVE, pointLParam(cursor.x, cursor.y));
}

module.exports = { startNativeWindowDrag, pointLParam };
