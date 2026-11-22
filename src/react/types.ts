import type { ComponentType, ReactNode } from "react";

/** What the app's overlay shell takes: its scrim, sheet, header with the ×
 * and keyboard (focus in on open, Escape, Tab kept inside, a press on the
 * scrim closes). Each app has one; the full view is drawn inside it. */
export type ShellProps = {
  /** The dialog's accessible name. */
  label: string;
  /** The sheet itself: its layout and size. */
  dialogClassName: string;
  headerClassName: string;
  /** What sits in the header before the ×. */
  header: ReactNode;
  onClose: () => void;
  children: ReactNode;
};
export type Shell = ComponentType<ShellProps>;

/** The two icons on the buttons, the app's own set. */
export type Icons = { expand: ReactNode; download: ReactNode };

/** The words on and about the buttons, in the app's language. */
export type Strings = {
  /** The full-view button's tooltip. */
  full: string;
  /** The download button's tooltip and the full view's header button. */
  download: string;
  /** Accessible names, the picture's title first. */
  fullOf: (title: string) => string;
  downloadOf: (title: string) => string;
};

export const strings: Strings = {
  full: "Full view",
  download: "Download SVG",
  fullOf: (title) => `${title}: full view`,
  downloadOf: (title) => `${title}: download SVG`,
};

/** The class names the parts are drawn with: Tailwind utilities on the
 * apps' shared tokens (bg-panel, text-faint, rounded-ui-sm ...). An app
 * missing a token passes its own. */
export type Classes = {
  /** The card's outermost box: its spacing in the page. */
  card: string;
  /** One icon button in the row. */
  button: string;
  /** The row of buttons above the package's own drawing. */
  tools: string;
  /** The frame around a drawing the renderer made, which brings no canvas
   * of its own. */
  frame: string;
  /** The buttons over that frame's top right corner, on a fade of it. */
  over: string;
  /** The full view's sheet, header and download button. */
  sheet: string;
  header: string;
  title: string;
  save: string;
};

export const classes: Classes = {
  button:
    "grid h-7 w-7 place-items-center rounded-ui-sm text-faint hover:bg-active hover:text-ink-dim",
  card: "mt-3",
  tools: "mb-1 flex items-center justify-end gap-0.5",
  frame: "rounded-ui-sm border border-border bg-panel p-3",
  over: "absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 bg-gradient-to-l from-panel from-70% to-transparent pl-6",
  // Sized to the drawing up to the window, a phone's full screen.
  sheet:
    "flex h-full w-full flex-col overflow-hidden rounded-none border-0 bg-panel font-sans shadow-panel sm:h-auto sm:max-h-full sm:w-fit sm:max-w-full sm:min-w-[min(100%,560px)] sm:rounded-ui-lg sm:border sm:border-elevated-border",
  header:
    "flex items-center gap-2 border-b border-border px-3 py-2.5 sm:gap-3 sm:px-4.5 sm:py-3",
  // contain: inline-size: the title adds no width to the sheet, which is
  // sized to the drawing; it takes the room there is and truncates.
  title: "min-w-0 flex-1 truncate text-[13.5px] text-ink [contain:inline-size]",
  save: "hidden h-8 items-center gap-1.5 rounded-ui-sm border border-border px-2.5 text-[13px] text-ink-dim hover:border-elevated-border hover:bg-active sm:flex",
};
