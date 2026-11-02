## Yzo 0.9.0

A big step toward a daily-driver browser: real downloads, settings, private browsing, an ad and tracker shield, and a split view that works like Arc's.

### Highlights

- **Split view, the Arc way.** Drag a tab from the sidebar onto a page and drop it on a side to split, or drop it on another tab in the sidebar. Each page gets its own bar in the site's color with back, forward, reload, the address, a grip to reorder panes (they slide out of the way), a split controls menu and a cross to take the pane out of the split.
- **Downloads.** The download button lists this session's downloads with progress, open, show in folder, pause, resume, cancel and move to the Recycle Bin. `yzo://downloads` keeps the full history, grouped by day and searchable. Choose the download folder, or have Yzo ask every time.
- **Settings.** `yzo://settings`, from the Yzo menu: account and sync, search engine, tabs, downloads and About Yzo.
- **Private browsing.** The incognito button opens a private Yzo in its own process: nothing it browses reaches the disk, and its throwaway profile is deleted afterwards. Extensions can be allowed in private windows one by one.
- **Shield.** Ads and trackers are blocked on every site (Ghostery's engine with the EasyList and EasyPrivacy lists). The site panel shows how many requests were blocked and turns the shield off for a site.
- **Site panel.** The sliders next to the address open an Arc-style panel: share the URL, the shield, the connection with the site's certificate, developer tools, and clearing the site's cache or cookies.
- **Extensions page.** `yzo://extensions`: search, turn extensions on or off (an extension that is off never runs), details with permissions written like Chrome's, size, pin to the toolbar and removal.
- **Browser menu.** The "…" button holds new tab, new private window, downloads, extensions, print, save page as, a zoom row, settings, developer tools, help and quit.
- **Full screen and a hideable top bar.** A full screen button, and a top bar you can hide (Ctrl+Shift+S) that slides back over the page when you reach the top edge and still moves the window.
- **Overlay scrollbars.** Thin scrollbars drawn over the page, shown only while scrolling.

### New shortcuts

Ctrl+Shift+N (private window), Ctrl+J (downloads), Ctrl+P (print), Ctrl+= / Ctrl+- / Ctrl+0 (zoom), Ctrl+Shift+Q (quit).

### Also

- Extension permissions are listed like Chrome's warnings: harmless ones are no longer shown.
- Pinned extension icons in the top bar are smaller.
- A menu opened from another menu no longer closes right away.

The full list is in the [CHANGELOG](https://github.com/behsse/yzo-browser/blob/main/CHANGELOG.md).
