## Yzo 0.10.0

Several windows at once, and a round of fixes for full-screen video, split view and extensions.

### Highlights

- **New windows.** Ctrl+N, or New Window in the Yzo menu and the "…" menu, opens another window. Spaces, pinned tabs and favorites are shared and stay in sync live between windows; each window keeps its own today tabs, selected tab, space and sidebar layout. A new window opens empty, on the command bar. Closing a window while others stay open sends its today tabs to the archive; quitting keeps them for the next launch.
- **One page, one window.** A pinned tab or favorite moves to the window that shows it, without reloading. If it is already on screen in another window, you get "Show here" and "Go to window" instead.
- **Full-screen video, like other browsers.** A video's full-screen button now fills the whole screen: no sidebar, no top bar, no rounded corners and no black bands. Escape, F11 or switching tabs leaves full screen.
- **uBlock Origin Lite works.** Its popup no longer shows "No website": extensions now see the tab you are on, and extensions that use the `browser` namespace no longer crash at startup.

### New shortcut

Ctrl+N (new window). Ctrl+Shift+Q (quit) now closes every window.

### Fixes

- The selected pane of a split no longer flickers between panes while their pages load at startup; a pane is selected when you click it.
- A tab loading in the background no longer takes the selection.
- An extension's popup opened from the floating top bar no longer closes on its own.
- The floating sidebar is no longer framed by the split's purple focus ring.

The full list is in the [CHANGELOG](https://github.com/behsse/yzo-browser/blob/main/CHANGELOG.md).
