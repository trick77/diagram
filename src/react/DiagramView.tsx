import { useCallback, useRef, type ReactNode } from "react";
import { useRoom, type Redraw } from "./useRoom";
import { useFit } from "./useFit";
import { download, toSvgFile } from "../export";
import { DiagramSvg } from "./DiagramSvg";
import {
  classes as defaultClasses,
  strings as defaultStrings,
  type Classes,
  type Icons,
  type Shell,
  type Strings,
} from "./types";

/** What the window loses around a drawing in the full view: the body's
 * padding (p-6) and a gutter of the shell's either side. The sheet is as
 * wide as its drawing, so it cannot be measured for room itself. */
const chrome = 2 * 24 + 2 * 16;

/**
 * DiagramView is the diagram seen whole. On the page a wide picture is
 * scaled into the text column; here the sheet takes the drawing's own size,
 * up to the window, so a small one gets a small sheet and a wide one the
 * whole window. A phone gets the full screen. A fixed sheet (rongo's
 * 1100px) was narrower than almanach's 1400px page column: the full view
 * must have more room than the page, not less. On a window just over the
 * column's width the sheet's padding leaves a wide drawing a few pixels
 * under the page's (almanach user's choice, 2026-11-01): the whole drawing
 * in view beats a 1:1 crop that has to be panned. Down to half size only
 * (useFit): a wide one on a phone is panned and pinch-zoomed there.
 *
 * The shell is the app's own overlay.
 */
export function DiagramView({
  svg,
  title,
  fileName,
  onClose,
  shell: OverlayShell,
  icons,
  strings = defaultStrings,
  classes = defaultClasses,
  overlay,
  redraw,
}: {
  svg: string;
  title: string;
  /** The download's name (../export fileName). */
  fileName: string;
  onClose: () => void;
  shell: Shell;
  icons: Pick<Icons, "download">;
  strings?: Strings;
  classes?: Classes;
  /** Laid over the drawing, sized to it: almanach's node links. */
  overlay?: ReactNode;
  /** Draws the source again for a width (useRoom): here the window's. */
  redraw?: Redraw;
}): ReactNode {
  const body = useRef<HTMLDivElement>(null);
  const measure = useCallback(
    () => Math.max(0, window.innerWidth - chrome),
    [],
  );
  const watch = useCallback((changed: () => void) => {
    window.addEventListener("resize", changed);
    return () => window.removeEventListener("resize", changed);
  }, []);
  // null while a timeline drawn for the wrong room waits for the right one.
  const shown = useRoom(svg, redraw, measure, watch);
  const fit = useFit(body, shown);

  function save() {
    download(fileName, toSvgFile({ svg: shown ?? svg }, body.current));
  }

  return (
    <OverlayShell
      label={title}
      dialogClassName={classes.sheet}
      headerClassName={classes.header}
      onClose={onClose}
      header={
        <>
          <span className={classes.title}>{title}</span>
          <button type="button" onClick={save} className={classes.save}>
            {icons.download}
            {strings.download}
          </button>
        </>
      }
    >
      {/* The drawing fits the sheet's width, its height while the text
          stays readable, and grows no further than 1:1 (useFit): a small
          diagram stays 1:1 and is centred. One explicit column: an
          implicit one grows to the drawing, the wrapper's max-w-full then
          caps nothing, and a wide drawing scrolled sideways (1578px in a
          1198px body). A flex column, so a tall one scrolls here instead
          of overflowing the sheet's max height. On a phone it stops
          shrinking at half size: the body scrolls both ways, touch left
          to the browser for pan and pinch-zoom. Items at the start: a
          centred overflow spilled out of the scroll on the left, out of
          reach. */}
      <div
        ref={body}
        className="grid min-h-0 flex-1 grid-cols-1 items-center justify-items-start overflow-auto p-6"
      >
        {/* As wide as the drawing, so an overlay's percent boxes land on
            its nodes; auto margins centre it while it fits. Held to the
            body unless the phone's floor made it wider (useFit): a room
            read a pixel wide at a browser zoom never scrolls sideways. */}
        <div
          className={`relative mx-auto w-max${fit?.wider ? "" : " max-w-full"}`}
          style={fit === null ? undefined : { width: fit.width }}
        >
          {shown !== null && <DiagramSvg svg={shown} title={title} />}
          {overlay}
        </div>
      </div>
    </OverlayShell>
  );
}
