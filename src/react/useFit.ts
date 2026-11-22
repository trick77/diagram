import { useLayoutEffect, useState, type RefObject } from "react";
import { svgSize } from "../export";

/**
 * useFit is the width, in px, a drawing in the full view is shown at: fitted
 * to the sheet's width, never past 1:1, and to its height down to a
 * readable floor (scale: 0.75, or 0.9 of a width fit already below it),
 * the body scrolling past it. Fitted by width alone, a wide and tall
 * drawing (1150×783 in a 761px body) scrolled ~70px where the sheet should
 * show it whole; fitted to the height at any cost, a 22-node map (1080×1458
 * in 720px) drew at 0.49, its 13px labels at ~6px. null where nothing can
 * be measured (no layout, no size on the drawing): the classes alone then
 * fit it by width.
 *
 * The room is the most the body can take, read off the shell rather than
 * the body itself: the sheet is sized to its drawing, so the body's own
 * size follows whatever was fitted last, and fitting to it would shrink
 * the drawing again on every pass. The scrim's inner box less the sheet's
 * chrome (header, borders) and the body's padding.
 */
export function useFit(
  body: RefObject<HTMLElement | null>,
  svg: string | null,
): number | null {
  // The fit and the drawing it was measured for: another drawing's fit is
  // none until it is measured itself.
  const [fit, setFit] = useState<{ of: string; w: number | null } | null>(null);
  useLayoutEffect(() => {
    const el = body.current;
    const size = svg === null ? null : svgSize(svg);
    if (!el || !size || svg === null) return;
    const measure = () => {
      const r = room(el);
      setFit({ of: svg, w: r === null ? null : size.w * scale(size, r) });
    };
    // Before the first paint: the drawing is never shown at the wrong size.
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [body, svg]);
  return fit !== null && fit.of === svg ? fit.w : null;
}

/** The least scale the height may push a drawing to: below it, labels
 * set at 11.5 to 13.5px drop under ~9px and stop reading. */
const readable = 0.75;
/** Where the width alone already shrinks a drawing below that (a phone, a
 * narrow window), the height may take a tenth more of it. */
const narrow = 0.9;

/** scale is the drawing's size against 1:1: the width's fit, and the
 * height's down to a floor, where the drawing stops shrinking and the body
 * scrolls. Continuous in the room: a window resized across the floor moves
 * the drawing by as much as the window, never by a jump. */
function scale(
  size: { w: number; h: number },
  r: { w: number; h: number },
): number {
  const wide = Math.min(1, r.w / size.w);
  const tall = Math.min(1, r.h / size.h);
  const floor = Math.min(readable, narrow * wide);
  return Math.min(wide, Math.max(tall, floor));
}

/** room is the body's most: its content box were the sheet as large as the
 * shell lets it be. null when there is nothing laid out to read. */
function room(el: HTMLElement): { w: number; h: number } | null {
  const sheet = el.parentElement;
  const scrim = sheet?.parentElement;
  if (!sheet || !scrim) return null;
  const pad = (e: HTMLElement) => {
    const s = getComputedStyle(e);
    const n = (v: string) => parseFloat(v) || 0;
    return {
      x: n(s.paddingLeft) + n(s.paddingRight),
      y: n(s.paddingTop) + n(s.paddingBottom),
    };
  };
  const shell = pad(scrim);
  const own = pad(el);
  const w =
    scrim.clientWidth - shell.x - (sheet.offsetWidth - el.offsetWidth) - own.x;
  const h =
    scrim.clientHeight -
    shell.y -
    (sheet.offsetHeight - el.offsetHeight) -
    own.y;
  return w > 0 && h > 0 ? { w, h } : null;
}
