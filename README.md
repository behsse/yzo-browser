# Yzo

A desktop browser inspired by Arc, rebuilt "clean room" from an analysis of Arc for Windows. No Arc code, image or asset is copied: only observed behavior, data shapes and enumerations served as reference. The analysis notes stay local (`re/` folder, excluded from the repository).

Stack: Electron 43 in its [castLabs ECS](https://github.com/castlabs/electron-releases) build (Chromium + Widevine, like `ArcCore.dll`) · React 19 · TypeScript 7 · Vite 8 · Vitest 5.

## Features

| Feature | Details |
|---|---|
| Top bar | Like Arc: logo (app menu), sidebar toggle, back, forward, reload on the left; the current site in the middle (click to edit, link icon to copy, sliders for site settings); pinned extensions, the extensions panel, split view and window controls on the right. The bar moves the window. |
| Vertical sidebar | Favorites shared across spaces, pinned section, divider, "today" tabs. Resizable (180–420 px). |
| Spaces | Name, emoji, two-color gradient from Arc's palettes (pastel, muted, gray), light/dark/auto mode. Dock at the bottom of the sidebar. |
| Command bar | One input for URLs, search and switching to an open tab. Title + domain deduplication for Figma, Notion, GitHub… Remembers the result type picked for each query. |
| Split view | 2 to 4 panes, side by side or stacked, draggable dividers, saved as a sidebar item. Drag a sidebar tab onto a page (or onto another tab in the sidebar) to split; each page gets an Arc-style bar in the site's color (navigation, address, a grip to drag the pane, the split controls menu, a cross to take the pane out of the split). |
| Peek | Links that open a new window (`target=_blank`) show in a preview, with an "Open in a tab" button. |
| Archive | Closed or idle today tabs are archived and can be restored. Auto-archive delay: 1 h, 12 h (default), 24 h, 7 d, 30 d or never. |
| Folders | Create, rename, collapse, drag and drop, nesting. |
| Pinned tabs | Closing a pinned tab unloads it and brings it back to its original URL, like Arc. |
| Hidden sidebar and top bar | `Ctrl+S` hides the sidebar; it reappears when hovering the left edge. `Ctrl+Shift+S` (or the lock button) hides the top bar for a full-screen view; it slides down over the pages when the pointer reaches the top edge, and still moves the window (drag it, double-click to maximize). |
| Site panel | The sliders next to the address open a panel like Arc's: "Share URL", the tracking protection (with the number of requests it blocked on the page; click to turn it off or on for the site), and a footer with the connection ("Secure" opens the site's certificate in the system's certificate window on Windows and macOS), developer tools and "…" (clear the site's cache or cookies, all site settings). |
| Shield | Blocks ads and trackers like Brave, with Ghostery's adblocker engine (`@ghostery/adblocker-electron`, MPL-2.0) and the EasyList / EasyPrivacy family of lists: blocked requests and hidden ad slots. On for every site by default; the sites it is turned off for are kept in `userData/shield.json`. The compiled engine is cached in `userData/shield-engine.bin` and rebuilt from fresh lists once a week. |
| Browser menu | The "…" button: account, new tab and private window, downloads, extensions, print, save page as, zoom (kept per site), full screen, settings, developer tools, help, quit. |
| Downloads | The download button lists this session's downloads with their progress, a folder button and a "…" menu (open, copy link, remove, Recycle Bin, pause, cancel); `yzo://downloads` keeps the history by day, with search. Files go to the folder chosen in the settings, or Yzo asks each time. |
| Settings | `yzo://settings/<section>` ("Settings" in the Yzo menu): account, search engine, tabs, downloads, about. |
| Extensions page | `yzo://extensions` ("Manage extensions" in the extensions panel): search, one card per extension with details, removal and an on/off switch; `yzo://extensions/<id>` shows, like Arc, its version, size, permission warnings, a pin to the toolbar, its options, Chrome Web Store page and source. Turned-off extensions are not loaded; "Allow in private browsing" lets one run in private windows. Choices in `userData/extension-settings.json`. |
| Yzo pages | `yzo://settings/sites/<site>` shows a site's settings in a tab (shield, connection, permissions, clearing cookies and cache). Yzo pages are drawn by the interface itself, not loaded as web pages. |
| Private browsing | The incognito button (next to reload) opens a private Yzo in its own process, like Zen: its tabs live in an in-memory session, so cookies, site storage, cache and history never reach the disk, and it starts from a fresh state that is never saved. No account, sync or Arc import there, and only the extensions allowed in private browsing (then the session is on disk in the throwaway profile and wiped when the window closes, since Electron cannot load extensions in an in-memory one). Private windows are near-black and the button stays lit there. |
| Chrome extensions | Install from the Chrome Web Store ("Add to Chrome" button, with a permission confirmation), automatic updates. The puzzle button opens the extensions panel: click an extension to open its popup, hover it and click the pin to show it in the top bar, right-click for options and removal, "+" to add more. Popups, badges, context menus and the tabs API (`chrome.tabs`) are supported. |
| Account and sync | Yzo account (sign in from the menu behind the logo): spaces, favorites, pinned tabs, folders and settings synced across computers, **end-to-end encrypted** (the server sees neither the password nor the data). Recovery key at sign-up, session kept in the system keychain. See [docs/sync.md](docs/sync.md). |
| Protected video (DRM) | Widevine through castLabs ECS: Spotify, Deezer, Prime Video, Disney+… Netflix and the strictest services also require production VMP signing (see "Distribution"). |
| Updates | Installed builds check GitHub Releases at startup and update in the background (`electron-updater`). |
| Import from Arc | Yzo menu (logo) > "Import from Arc…": Arc's spaces (name, emoji), their pinned and today tabs, folders and split views, the favorites, and the extensions (installed from the Chrome Web Store) are added after a confirmation. Existing spaces are kept and Arc's files are only read. Windows (Arc from the Microsoft Store) and macOS. |
| Persistence | JSON state written atomically to the `userData` folder, with a `.bak` copy. |

## Shortcuts

They also work while a web page has focus: the main process intercepts them before the page.

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab (command bar) |
| `Ctrl+L` | Edit the active tab's address |
| `Ctrl+W` | Close / archive (unload if pinned) |
| `Ctrl+Shift+T` | Reopen the last archived tab |
| `Ctrl+D` | Pin / unpin |
| `Ctrl+S` | Show / hide the sidebar |
| `Ctrl+Shift+S` | Lock / hide the top bar |
| `Ctrl+Shift+=` | Add a split view pane |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1` … `Ctrl+9` | Go to space N |
| `Ctrl+R`, `F5` | Reload |
| `Alt+←` / `Alt+→` | Back / forward |
| `Ctrl+Shift+C` | Copy the URL |
| `Ctrl+Shift+K` | Archive all today tabs |
| `Ctrl+Alt+N` | New folder |
| `Ctrl+Y` | Archive and settings |
| `Ctrl+Shift+I`, `F12` | Page developer tools |
| `Ctrl+Shift+N` | New private window |
| `Ctrl+J` | Downloads |
| `Ctrl+P` | Print the page |
| `Ctrl+=`, `Ctrl+-`, `Ctrl+0` | Zoom in, zoom out, actual size |
| `Ctrl+Shift+Q` | Quit |

The full table lives in [shared/shortcuts.json](shared/shortcuts.json), shared by the UI and the main process.

## Getting started

Requirements: Node.js 24 and pnpm 9.

```bash
pnpm install
```

If the Electron binary was not downloaded during install (no `node_modules/electron/dist` folder):

```bash
node node_modules/electron/install.js
```

`pnpm dev`, `pnpm build` and `pnpm start` first generate `electron/preload.generated.cjs` (UI preload + extension icon support) through `pnpm preload`.

Sync uses the official server `https://yzo-browser-backend.vercel.app` by default in packaged builds and the local server `http://127.0.0.1:3100` in development (private `yzo-cloud` repository), unless `YZO_SYNC_URL` is set. The address can also be changed in the Account panel, "Server" section.

Development mode (Vite + Electron, hot reload of the UI):

```bash
pnpm dev
```

Production build:

```bash
pnpm build
```

```bash
pnpm start
```

Checks:

```bash
pnpm typecheck
```

```bash
pnpm test
```

## Distribution

Installers are generated in `release/` by [electron-builder](https://www.electron.build/) (configuration in `package.json`, `build` key):

```bash
pnpm dist:win
```

```bash
pnpm dist:mac
```

```bash
pnpm dist:linux
```

| System | Formats | Architectures |
|---|---|---|
| Windows | NSIS installer (`Yzo-Setup-<version>.exe` for both architectures, `Yzo-Setup-<version>-<arch>.exe` per architecture) | x64, arm64 |
| macOS | DMG + ZIP (the ZIP is used for updates), hardened runtime | x64, arm64 |
| Linux | AppImage, .deb | x64 |

macOS can only be built on a Mac. The easiest path is pushing a tag: the [.github/workflows/release.yml](.github/workflows/release.yml) workflow builds all three systems and publishes a draft GitHub release. Once published, installed builds pick it up.

```bash
git tag v0.6.0
```

```bash
git push origin v0.6.0
```

VMP signing (castLabs EVS, required for Netflix and the strictest services): create a free account with `python -m pip install castlabs-evs` then `python -m castlabs_evs.account signup`, and build with `YZO_VMP_SIGN=1`. In CI, set the `EVS_ACCOUNT_NAME` and `EVS_PASSWD` secrets. The `scripts/after-pack.cjs` (macOS, before code signing) and `scripts/after-sign.cjs` (Windows, after) hooks take care of it. Linux has no VMP.

Code signing (optional, avoids SmartScreen and Gatekeeper warnings): `CSC_LINK` / `CSC_KEY_PASSWORD` secrets (certificate), plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for macOS (notarization, Apple Developer account). Without a certificate, Windows builds are unsigned and macOS builds get an ad-hoc signature.

The `build/icon.png` icon is generated by `pnpm icon` (`scripts/make-icon.mjs`).

## Architecture

```
electron/main.cjs        Frameless window, IPC, persistence, page policy (shortcuts, popups, context menu)
electron/views.cjs       One native WebContentsView per loaded tab (and for Peek): creation, layout, stacking, commands
electron/menu-popup.cjs  Popup menus in a transparent view above the pages (menu.html/js/css), so pages keep playing
electron/arc-import.cjs  Reads Arc's StorableSidebar.json, cached icons and extension list for "Import from Arc"
electron/favicon.cjs     Finds the icon of a site without opening it (tabs never loaded)
electron/extensions.cjs  Chrome extensions: Web Store, chrome.* APIs (tabs, actions, menus)
electron/account.cjs     Yzo account: server connection, session encrypted by the system keychain
electron/crypto.cjs      End-to-end encryption (scrypt, HKDF, AES-256-GCM, recovery key)
electron/i18n.cjs        Translations for native menus and dialogs
electron/preload.cjs     Narrow window.yzo bridge (state, window, shortcuts, Peek)
src/sync/                Record projection, merging, sync loop (SyncProvider)
scripts/after-*.cjs      electron-builder hooks: castLabs EVS VMP signing (vmp.cjs)
scripts/build-preload.mjs Bundles the UI preload with extension icon support
shared/shortcuts.json    Shortcut table (UI + main process)
shared/locales/          UI translations, en.json (reference) and fr.json (UI + main process)
src/state/               Model (types.ts), tree operations (tree.ts), reducer, persistence, React store
src/lib/                 URL, command bar, themes, auto-archive, shortcuts, tab commands, i18n
src/ui/                  Top bar, sidebar, item tree, web area, panels, command bar, Peek, archive, space editor
```

The model follows the one observed in Arc's `StorableSidebar.json`. Every item lives in a flat table, linked by `parentId` and `childrenIds`:

- **containers**: favorites, and for each space a pinned section and a today section;
- **tabs**;
- **folders**;
- **split views**.

Every action goes through a pure reducer working on a copy; the previous state is never mutated.

The interface is translated into English and French. The language follows the system's (`app.getLocale()` in the main process, `navigator.language` in the UI); any language other than French falls back to English. Strings live in [shared/locales/](shared/locales/): to add a language, copy `en.json`, translate every value and register the file in `src/lib/i18n.ts` and `electron/i18n.cjs`. The tests fail when a locale misses a key or changes a `{placeholder}`.

Each loaded tab is a native `WebContentsView` managed by the main process ([electron/views.cjs](electron/views.cjs)). The UI only lays out empty placeholders (`ViewHost`) and sends their rectangles to the main process, which positions the pages there. The window is a frameless `BaseWindow` holding three kinds of views, bottom to top: the UI view, the tab views, then Peek and the popup menu ([electron/menu-popup.cjs](electron/menu-popup.cjs)). The UI view is transparent and its backdrop (the space gradient) has a rounded hole over each page (`src/lib/pageMask.ts`). When an overlay opens (command bar, floating sidebar, panels, Peek) or a divider is dragged, the UI view is stacked above the tab views: overlays are drawn over the live pages, so videos keep playing and nothing jumps when the overlay closes.

## Security

- UI: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP. The UI never navigates and cannot embed a `<webview>`; only tab views load pages.
- Pages: created by the main process, without preload, sandboxed. Only `http(s)` and `about:blank` are allowed, on open as well as on navigation: no `file:`, `javascript:` or custom protocols. IDs, URLs and rectangles sent by the UI are validated.
- Popups (OAuth sign-ins): real windows sharing the tabs' session, same scheme rules.
- Identity: a standard Chrome user agent, with no mention of Electron.
- IPC channels only accept the UI as sender. State size and JSON are validated before writing.
- Ads and trackers are blocked by the shield (Ghostery's engine) unless the user turns it off for a site. Its lists are downloaded from Ghostery's GitHub repository.
- Certificates: Chromium verifies them as usual; Yzo only records the certificate each host presented, to show it on request.
- Site permissions are denied by default, except fullscreen, clipboard write, pointer lock and key system access (DRM).
- A corrupted or unknown state file is ignored at startup: the app starts from a fresh state instead of crashing.

## Known limitations

- No Boosts, Easels or Little Arc. History and archive are not synced.
- Forgotten password: email recovery (Resend) is not wired yet; the recovery key can already decrypt the vault, but its screen is still to be built.
- The interface is available in English and French only, and follows the system language (there is no in-app language setting yet).
- Extensions: `chrome.runtime.onInstalled` does not fire under Electron; extensions that only create their context menus at that moment will have none. Chrome APIs not covered by Electron or `electron-chrome-extensions` remain unavailable.
- Arc's default shortcuts could not be extracted from the binary. The ones above follow Chromium's and Arc's public conventions.
- Without an EVS account, builds keep castLabs' development VMP signature: Netflix refuses playback.
- Private browsing: Chromium still writes its own files (GPU caches, local settings) to a throwaway profile under `userData/Private profiles/`, deleted the next time a private window opens. Extensions allowed in private browsing need an on-disk session there; it is wiped when the window closes.
- Builds are unsigned until a certificate is provided: SmartScreen (Windows) and Gatekeeper (macOS) warn at install.

## License

Yzo is distributed under the [GNU GPL v3.0 or later](LICENSE). It notably uses [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell) under GPL-3.0 and [electron-chrome-web-store](https://github.com/samuelmaddock/electron-browser-shell) under MIT.
