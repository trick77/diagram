import { useCallback, useRef, useState, type ReactNode } from "react";
import { useRoom, type Redraw } from "./useRoom";
import { download, toSvgFile } from "../export";
import { DiagramSvg } from "./DiagramSvg";
import { DiagramTools } from "./DiagramTools";
import { DiagramView } from "./DiagramView";
import {
  classes as defaultClasses,
  strings as defaultStrings,
  type Classes,
  type Icons,
  type Shell,
  type Strings,
} from "./types";

/**
 * DiagramCard is a drawn diagram as it sits in the text: the picture and
 * its two ways out, the full view and the file.
 *
 * The package's own drawing brings its canvas, so the card is only a frame
 * for the buttons, as wide as the drawing and never wider than the text it
 * sits in: a picture running past the prose read as out of place. Wider
 * than the text it is scaled down, never scrolled; the full view is there
 * to read it at size. A drawing the mermaid renderer made (own false)
 * brings no canvas and gets a framed panel.
 *
 * The buttons are always drawn, never revealed on hover: a phone has no
 * hover, and the full view is the only way it sees a wide diagram whole.
 * On the renderer's drawing they sit over the panel's corner on a fade of
 * it. On the own drawing they sit in a row above the canvas, flush with
 * its right edge: inside it they covered a sequence's last participant at
 * inline scale, and a band kept clear for them went into every file and
 * full view, where there are no buttons.
 */
export function DiagramCard({
  svg,
  title,
  fileName,
  own = false,
  shell,
  icons,
  strings = defaultStrings,
  classes = defaultClasses,
  overlay,
  redraw,
}: {
  svg: string;
  /** The picture's name: the accessible label and the full view's header. */
  title: string;
  /** The download's name (../export fileName). */
  fileName: string;
  /** The package's drawing (true), or the renderer's (false, the default:
   * ./mermaid draw marks only its own, `own={drawn.own}` passes it on; a
   * drawIR drawing passes true). */
  own?: boolean;
  shell: Shell;
  icons: Icons;
  strings?: Strings;
  classes?: Classes;
  /** Laid over the drawing, sized to it, in the card and in the full view:
   * almanach's node links. close shuts the full view, for a link followed
   * from it. */
  overlay?: (view: { full: boolean; close: () => void }) => ReactNode;
  /** Draws the source again for a width: a timeline lies flat or stands
   * up by the room it has (useRoom). The card measures the text it sits
   * in, the full view the window. */
  redraw?: Redraw;
}): ReactNode {
  const [full, setFull] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  // The block the card sits in, as wide as the text: the card itself is
  // only as wide as its drawing, and a timeline standing up would never
  // measure room to lie flat.
  const room = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => room.current?.clientWidth ?? 0, []);
  const watch = useCallback((changed: () => void) => {
    const el = room.current;
    if (el === null || typeof ResizeObserver === "undefined") return () => {};
    const ro = new ResizeObserver(changed);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // null while a timeline drawn for the wrong room waits for the right one.
  const shown = useRoom(svg, redraw, measure, watch);
  const close = () => setFull(false);

  function save() {
    download(fileName, toSvgFile({ svg: shown ?? svg }, card.current));
  }

  const tools = (
    <DiagramTools
      title={title}
      onFull={() => setFull(true)}
      onSave={save}
      icons={icons}
      strings={strings}
      classes={classes}
      over={!own}
    />
  );

  return (
    <div ref={room} className={classes.card}>
      <div
        ref={card}
        className={own ? "w-max max-w-full" : `relative ${classes.frame}`}
      >
        {tools}
        <div className="relative">
          {shown !== null && <DiagramSvg svg={shown} title={title} />}
          {overlay?.({ full: false, close })}
        </div>
        {full && (
          <DiagramView
            svg={shown ?? svg}
            redraw={redraw}
            title={title}
            fileName={fileName}
            onClose={close}
            shell={shell}
            icons={icons}
            strings={strings}
            classes={classes}
            overlay={overlay?.({ full: true, close })}
          />
        )}
      </div>
    </div>
  );
}
