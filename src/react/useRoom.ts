import { useLayoutEffect, useRef, useState } from "react";
import { flips, lie } from "../export";

/** Draws the diagram again for a width, the app's own way (with ./mermaid,
 * `(w) => draw(src, { width: w })`, its svg or null). The card cannot draw:
 * ./react never loads the renderer. */
export type Redraw = (width: number) => Promise<string | null>;

/**
 * useRoom is the drawing for the room it is shown in. Most drawings look
 * the same at any width and are shown as they come. A timeline lies flat
 * or stands up by its width (../timeline.ts): measured, and asked for again
 * only when the room crosses the width it lies flat at, so a resize by a
 * pixel draws nothing. Without redraw, or a room not measured yet (0),
 * the drawing stays as it came.
 *
 * The room is measured before the first paint, and a timeline drawn the
 * wrong way for it is not shown at all (null) until the right one is
 * there: shown, a standing timeline flipped flat a moment later.
 *
 * measure says the room, watch calls back when it may have changed and
 * returns its own undo; both are stable for the component's life.
 */
export function useRoom(
  svg: string,
  redraw: Redraw | undefined,
  measure: () => number,
  watch: (changed: () => void) => () => void,
): string | null {
  const [drawn, setDrawn] = useState<{ of: string; svg: string } | null>(null);
  // The drawing whose room has been measured once, and answered.
  const [settled, setSettled] = useState<string | null>(null);
  const current = drawn !== null && drawn.of === svg ? drawn.svg : svg;
  // The latest redraw, read when the room changes: an app passes a new
  // arrow on every render, and watching anew for each would rebuild the
  // observer as often.
  const latest = useRef(redraw);
  useLayoutEffect(() => {
    latest.current = redraw;
  });
  const able = redraw !== undefined;
  useLayoutEffect(() => {
    if (!able) return;
    let live = true;
    const check = () => {
      const width = measure();
      const ask = latest.current;
      if (ask === undefined || !flips(current, width)) {
        setSettled(svg);
        return;
      }
      ask(width).then(
        (s) => {
          if (!live) return;
          if (s !== null) setDrawn({ of: svg, svg: s });
          setSettled(svg);
        },
        // A drawing that failed leaves the one there, shown; the next
        // change of room asks again.
        () => {
          if (live) setSettled(svg);
        },
      );
    };
    check();
    const stop = watch(check);
    return () => {
      live = false;
      stop();
    };
  }, [svg, current, able, measure, watch]);
  const waits = able && lie(svg) !== null && settled !== svg;
  return waits ? null : current;
}
