# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.9.0] - 2026-10-27

### Added

- Split view by drag and drop, like Zen and Arc: drag a tab from the sidebar onto the pages and drop it on a side (the half it will take is highlighted) to split with that page, left/right side by side or top/bottom stacked; in a split, it goes before or after the pane it is dropped on. In the sidebar, dropping a tab in the middle of another tab (or of a split) splits them too.
- In a split, each page gets its own bar above it, like Arc: back, forward and reload on the left, the site with copy-link and site settings in the middle, and on the right a grip to drag the pane to another place (the other panes slide out of its way as it moves), the split controls menu (like Arc's: move left/right or up/down, add a split on either side through the command bar, separate the tab, switch between side by side and stacked) and a cross that takes the pane out of the split (with two panes, the split stops). The bar takes the color of the top of the site (read from its pixels when the page loads, at the top of the page; scrolling or bars appearing later do not change it) with dark or light text, and the top bar drops its navigation and address while a split shows.
- Browser menu behind the top bar's "…" button, with Brave's entries and the look of the Yzo menu: sign in, new tab, new private window, downloads, extensions, print, save page as, a zoom row like Brave's (− value + and full screen; the menu stays open while zooming), settings, developer tools, help and feedback, quit. New shortcuts: Ctrl+Shift+N (private window), Ctrl+J (downloads), Ctrl+P (print), Ctrl+= / Ctrl+- / Ctrl+0 (zoom), Ctrl+Shift+Q (quit).
- Downloads: the top bar's download button opens this session's downloads, like Chrome's and Arc's (it opens by itself when a download starts and turns blue while one runs). Each shows its file icon and progress ("118 MB of 1 GB"); a finished one opens on click, with "Show in folder" and a "…" menu (open, show in folder, copy link, remove from list, move to the Recycle Bin; pause, resume and cancel while it runs). "Show all downloads" opens `yzo://downloads`: the history grouped by day, with search, "Clear all", and deleted files struck through. Files go to a folder of your choice, or Yzo asks each time; names never overwrite an existing file ("notes (1).txt"). History in `userData/downloads.json`, settings in `userData/download-settings.json`; a private window keeps its downloads in memory.
- Settings (`yzo://settings`, "Settings" in the Yzo menu), laid out like Arc's: You and Yzo (account and sync), Search engine, Tabs (auto-archiving), Downloads (location and "Always ask where to save files"), a link to the extensions page and About Yzo (version, update check). `yzo://settings` opens the first section.
- Hideable top bar for a real full-screen view: the new lock button next to the sidebar toggle (or Ctrl+Shift+S) hides it and the pages take the full height. Moving the pointer to the top edge slides it down over the pages, like Zen Browser, and it hides again when the pointer leaves it. It still works as a title bar: dragging it moves the window (Windows runs the move, so snapping and restoring a maximized window work), and a double-click maximizes.
- Shield against ads and trackers, like Brave's: Ghostery's adblocker engine with the EasyList / EasyPrivacy family of lists blocks requests and hides ad slots on every site. The site panel shows how many requests it blocked on the page and turns it off or on for the site (the page reloads).
- Site panel under the sliders next to the address, like Arc's: a wide "Share URL" button, the tracking protection (on/off for the site, with the number of requests blocked on the page), and a footer with "Secure" (opens the site's certificate in the Windows certificate window, or macOS's), developer tools and "…" ("Clear cache", "Clear cookies", "All site settings").
- Extensions page (`yzo://extensions`, from "Manage extensions" at the bottom of the extensions panel), like Brave's and Arc's: search, one card per extension (icon, name, description) with "Details", "Remove" and an on/off switch. Details (`yzo://extensions/<id>`), laid out like Arc's: on/off, description, version, size, permissions, site settings (placeholder for now), pin to the toolbar, allow in private browsing, the extension's options, its Chrome Web Store page, source and removal.
- Extensions in private windows: "Allow in private browsing" in an extension's details lets it run in the next private windows (off by default, like Chrome). Electron cannot load extensions in an in-memory session, so a private window that runs extensions uses an on-disk session in its throwaway profile, wiped (storage and cache) when the window closes. Extension choices are read-only from a private window. The choices live in `userData/extension-settings.json`. A turned-off extension is not loaded at all, also on later starts: Yzo now loads the installed extensions itself instead of electron-chrome-web-store.
- Yzo pages: `yzo://settings/sites/<site>` opens a site's settings in a tab (shield, connection and certificate, permissions, clearing cookies and cache), drawn by the interface instead of a web page.
- Private browsing: the incognito button opens a private Yzo in its own process, like Zen. Its tabs use an in-memory session (no cookies, storage, cache or history on disk), it starts from a fresh state that is never saved, and it has no account, sync or Arc import; only the extensions allowed in private browsing run there. Private windows are always near-black (like Twitch's dark mode), whatever the space's colors. Each private instance gets a throwaway profile, deleted once it is closed and another private window opens.
- Full screen button in the top bar, after the top bar lock: it puts the window in full screen, and its arrows point inward while full screen is on, to leave it.

### Changed

- Scrollbars over the pages, like Arc's: Chromium's overlay scrollbars, drawn on top of the content without a column or track, thin and rounded, shown while scrolling, dark on light sites and light on dark ones. A site that styles its own scrollbars keeps them.
- Pinned extension icons in the top bar are smaller (15 px).
- Extension permissions (install prompt and details) are listed like Chrome's warnings: access to sites first ("all sites" covers the browsing history), then the sensitive APIs; harmless ones (storage, alarms, context menus…) are no longer listed.
- The site menu becomes the site panel: "Reload" leaves it (the reload button is next to it) and "Copy link" becomes "Share URL".
- Top bar layout: full screen button and a divider after the top bar lock, private browsing next to reload, downloads after the extensions, a menu button after split view, and more room around the address.

### Fixed

- A menu opened from another menu's entry no longer closes right away (the first menu's focus loss arrived after the second one opened).

## [0.8.0] - 2026-10-25

### Added

- "Import from Arc…" in the Yzo menu: adds Arc's spaces with their pinned and today tabs, folders and split views, its favorites, and installs its extensions from the Chrome Web Store, after a confirmation. Nothing in Yzo is replaced and Arc's files are only read.
- Tabs that were never opened (imported, restored, synced) get their site icon without being loaded: Yzo fetches the page in the background with the tabs' cookies and keeps the icon itself, falling back to the site's or parent domain's /favicon.ico. Imports from Arc reuse the icons Arc cached.
- Imported favorites are de-duplicated by site (Arc's Gmail inbox link and Yzo's Gmail favorite are one favorite).
- Extensions panel under the puzzle button, like Arc: every extension as a tile (click opens its popup), a pin in its bottom-right corner on hover (white once pinned) to show it in the top bar, right-click for options and removal, and "+" for the Chrome Web Store. Pinned extensions are synced with the other settings.

### Changed

- Arc-style top bar across the window: logo (app menu), sidebar toggle, back, forward and reload on the left; the current site in the middle with copy-link and site settings buttons; extension icons, the extensions menu, split view and window controls on the right. The sidebar loses its header rows and search field and now starts with the favorites.
- Only pinned extensions show in the top bar.
- The real Yzo logo replaces the placeholder "y" in the top bar, with smoothed curves and the same color as the other icons.
- The app icon (installers, taskbar, dock) now shows the Yzo logo in white on the gradient square; `pnpm icon` draws it from the same outline as the top bar.
- Icons have rounded corners instead of square ones, and the extensions icon is a full puzzle piece (tabs out on the top and right, notches in on the bottom and left).
- Top bar sized like Arc's (32 px, 16 px icons, buttons 36 px apart, window controls 46 px apart).
- The restore icon now shows the back window at the top right, like Windows.

### Fixed

- An extension popup opened from the extensions panel no longer closes right away (the page took the focus back as the panel closed).
- Hovering a pinned extension in the top bar no longer zooms its icon.
- Hovering the top bar no longer keeps the floating sidebar open.
- The floating sidebar slides in at its final size instead of growing from a slightly smaller card.
- The divider between the pinned and today sections sits at the same distance from the last pinned tab as from the "New tab" row.

## [0.7.0] - 2026-10-24

### Added

- Internationalization: the interface, page context menu and extension install dialog are translated into English and French, following the system language with English as the fallback. Translations live in `shared/locales/` and are shared by the UI and the main process; tests check that every locale has the same keys and placeholders.
- App menu behind the logo, like Arc: New Tab, New Window (shown disabled until multi-window exists), Check for Updates, and Sign in at the bottom (the Yzo account entry once signed in), with icons and shortcuts.
- Magnifier icon in the sidebar search field.
- Gmail replaces Linear as the third default favorite on new profiles.

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
