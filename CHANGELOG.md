# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added

- Internationalization: the interface, page context menu and extension install dialog are translated into English and French, following the system language with English as the fallback. Translations live in `shared/locales/` and are shared by the UI and the main process; tests check that every locale has the same keys and placeholders.
- App menu behind the logo, like Arc: New Tab, New Window (shown disabled until multi-window exists), Check for Updates, and Sign in at the bottom (the Yzo account entry once signed in), with icons and shortcuts.
- Magnifier icon in the sidebar search field.

### Changed

- README and CHANGELOG are now in English.
- The interface now ships in English by default (French on French systems), including the default space ("Personal") and folder names for new profiles.
- Every modal (command bar, space editor, account, archive) is centered in the window, horizontally and vertically.
- The account button left the space dock: the account is reached from the app menu.
- Space dock: emojis are centered in their square, and the active space keeps the hover look (background, full opacity, color).

### Fixed

- Pages are no longer frozen behind menus, the command bar, panels or the floating sidebar (a playing video kept running but its picture stopped, and the page "jumped" when the overlay closed). Menus are drawn in a transparent native layer above the pages, and the UI itself, now a transparent view of a `BaseWindow`, is stacked above the pages while an overlay is open instead of replacing them with screenshots.
- The floating sidebar no longer closes when the pointer moves onto a menu or dialog opened from it (extensions menu, space editor…); it waits until that menu or dialog is closed.
- Context menu shortcut hints were unreadable on the dark menu.

## [0.6.0] - 2026-10-24

### Added

- Protected video: Yzo runs on castLabs Electron for Content Security (`v43.7.7+wvcus`); Widevine is downloaded and ready before the window opens. The `mediaKeySystem` permission is granted to pages.
- Installers: Windows (NSIS, x64 and arm64), macOS (DMG + ZIP, x64 and arm64, hardened runtime), Linux (AppImage, .deb), through `pnpm dist:win`, `dist:mac`, `dist:linux`.
- Automatic updates from GitHub Releases (`electron-updater`).
- Production VMP signing (castLabs EVS), enabled with `YZO_VMP_SIGN=1`.
- GitHub Actions release workflow on `v*` tags for all three systems.
- App icon (`pnpm icon`).

### Changed

- Packaged builds sync with `https://yzo-browser-backend.vercel.app` by default.
- React is no longer a runtime dependency (it is already bundled into the UI).

## [0.5.0] - 2026-10-24

### Added

- Yzo account and end-to-end encrypted sync of spaces, favorites, pinned tabs, folders, pinned split views and settings (`docs/sync.md`). The password never leaves the device: scrypt then HKDF derive an authentication key (sent) and a wrapping key (kept). Data is encrypted with AES-256-GCM, bound to its identifier.
- Recovery key shown once at sign-up.
- Session and vault key stored encrypted by the system keychain (Electron `safeStorage`).
- Sync engine: state projection into records, change detection, merging with tree repair, adoption of account data on a fresh device, loop (startup, 60 s, 2 s after a change, retry on conflict).
- Account panel (person icon in the dock): sign-up, sign-in, sync status, manual sync, sign-out, account deletion.
- 15 tests (encryption, sync between two simulated devices).

## [0.4.0] - 2026-10-24

### Added

- Chrome extensions: install from the Chrome Web Store (the "Add to Chrome" button works, with a confirmation listing the permissions), loading at startup and automatic updates (`electron-chrome-web-store`).
- Extension APIs through `electron-chrome-extensions`: icons in the sidebar header with popups and badges, context menu entries, `chrome.tabs` (Yzo tabs are exposed as Chrome tabs; an extension can create, activate and close them).
- Extensions menu (puzzle button): installed extensions, options, removal, link to the Chrome Web Store.
- Extension pages (`chrome-extension://`, such as options pages) open in tabs.
- GPL-3.0-or-later license (`LICENSE`).

### Changed

- The UI preload is generated (`pnpm preload`) to include extension icon support, since the sandboxed preload cannot load external modules.
- The `re/` folder (Arc analysis notes) is excluded from the repository.

## [0.3.0] - 2026-10-24

### Changed

- Tabs move from `<webview>` (discouraged by Electron) to native `WebContentsView`s managed by the main process. The UI sends each page's position; navigation, titles, favicons and focus come back over IPC.
- Overlays (command bar, menus, floating sidebar, archive, space editor, Peek) "freeze" pages: capture, show the capture, then hide the native view, so they appear on top without a visible jump. Same mechanism while dragging split view dividers and resizing the sidebar.
- Peek uses its own native view, placed inside the preview card.
- Keyboard focus follows the selected tab.
- The UI window is no longer throttled in the background (`backgroundThrottling: false`), so page syncing continues while it is hidden.

## [0.2.0] - 2026-10-24

### Added

- Real popup windows for pages that open them (`window.open` with dimensions): "Sign in with Google / GitHub / …" flows keep their `window.opener` link and return the result to the site. Popups share the tabs' session and follow the same security rules.

### Changed

- Yzo identifies itself to sites as a standard Chrome (`Chrome/150.0.0.0`, without the `Electron` or `yzo` tokens), so Google and other services no longer treat it as an embedded browser.
- Links that opened Peek by default now open a tab; Peek remains available from the context menu.

## [0.1.1] - 2026-10-24

### Changed

- Smoother, more visible sidebar animations: the floating sidebar slides in from the left with a decelerating curve on open (340 ms) and leaves accelerating on close (170 ms, after a 120 ms grace period; ≈ 0.3 s total instead of ≈ 0.7 s), instead of disappearing at once. `Ctrl+S` collapses the docked sidebar's width while the page widens, instead of jumping. Animations are disabled when the system requests reduced motion.
- Margin around the web content reduced from 8 to 6 px.
- Two-row sidebar header: temporary "y" logo (stroked SVG, same height and center as the icons) on the left and minimize, maximize, close on the right on top; sidebar, back, forward, reload below, with an Extensions button aligned right (temporary "No extensions installed" menu, support did not exist yet). Window icons are the same size as the navigation ones.

### Fixed

- The hidden sidebar no longer reappeared when hovering the left edge: the edge was a window drag region, which receives no mouse events under Electron.
- In hidden mode, a strip at the top of the window can drag it again.
- The floating sidebar closed when moving the mouse up to its buttons: its header was a window drag region. It also tolerates a brief exit (120 ms).
- The floating sidebar's hover zone covers the whole left column: the top, bottom and left margins keep it open, only leaving to the right closes it. The real cursor position is read from the main process, since a webview captures mouse events.
- `pnpm dev` hung: Vite listened only on IPv6 while Electron waited on 127.0.0.1.

## [0.1.0] - 2026-10-24

### Added

- Reverse-engineering report of Arc 1.129 for Windows (REA + Ghidra 12.1.4) and related evidence in `re/`.
- Frameless Electron 43 app with a vertical sidebar, favorites, pinned and today sections, folders, drag and drop.
- Spaces with emoji, gradient from Arc's palettes, light/dark/auto modes, dock and `Ctrl+1…9` shortcuts.
- Command bar: URLs, search (Google, DuckDuckGo, Bing), switching to open tabs, history, title + domain deduplication, remembered choices.
- Split view with 2 to 4 panes, horizontal or vertical, resizable.
- Peek for links opened in a new window.
- Archive with configurable auto-archiving (1 h to 30 d, or never) and restore.
- Keyboard shortcuts active even when a page has focus.
- Atomic state persistence with a `.bak` backup and validation on load.
- Webview hardening (allowed schemes, sandbox, permissions denied by default).
- 43 Vitest tests: reducer, persistence, URL, command bar, themes, shortcuts.
