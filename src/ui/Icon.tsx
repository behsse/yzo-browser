/** 24-unit stroke paths, also sent as data to the popup menu layer. */
export const ICON_PATHS = {
  /** Placeholder brand mark: a stroked "y" spanning rows 6–18 like the window-control icons. */
  brand: "M7 6l5.33 8M17 6l-7 12",
  /** Puzzle piece: rounded tabs out on the top and right, rounded notches in on the bottom and left. */
  extensions: "M6 8H8V6.5a2 2 0 0 1 4 0V8h2a2 2 0 0 1 2 2v2h1.5a2 2 0 0 1 0 4H16v2a2 2 0 0 1-2 2h-2v-1.5a2 2 0 0 0-4 0V20H6a2 2 0 0 1-2-2v-2h1.5a2 2 0 0 0 0-4H4v-2a2 2 0 0 1 2-2z",
  back: "M15 18l-6-6 6-6",
  forward: "M9 18l6-6-6-6",
  reload: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  sidebar: "M7 5h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM9.5 5v14",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  minimize: "M5 12h14",
  maximize: "M8.5 6h7A2.5 2.5 0 0 1 18 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 15.5v-7A2.5 2.5 0 0 1 8.5 6z",
  restore: "M10 8h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM6 15V8a2 2 0 0 1 2-2h7",
  chevron: "M9 6l6 6-6 6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  archive: "M5 4h14a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 9v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4",
  copy: "M11 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM5 15a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h8a1 1 0 0 1 1 1",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  sliders: "M4 8h9M17 8h3M4 16h3M11 16h9M15 6v4M9 14v4",
  split: "M7 5h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM12 5v14",
  splitVertical: "M7 5h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM4 12h16",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5",
  sync: "M20 11a8 8 0 0 0-14.3-4.9M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9M20 20v-4h-4",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  tab: "M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z",
  pin: "M9 4h6l-1 6 3 3H7l3-3zM12 13v7",
  external: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 7.5 4 7l-1 3 2 1v2l-2 1 1 3 2-.5 1.5 1.5-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/**
 * Renders a 24×24 stroke icon.
 * @param props.name Icon to draw.
 * @param props.size Pixel size (default 18).
 * @returns SVG element, hidden from assistive technology.
 */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
