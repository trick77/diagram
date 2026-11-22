import { textWidth } from "./theme";

/**
 * Free text on a drawing that has no boxes: a timeline's periods and
 * events, a quadrant's names and point labels. Measured by the theme's
 * budget like a box's label, placed by its own layout, drawn by draw.ts.
 */

/** What a text is, for the checks and the tests; the drawing reads only
 * its role. */
export type PlotTextKind =
  "title" | "section" | "period" | "event" | "axis" | "quadrant" | "point";

export type PlotText = {
  kind: PlotTextKind;
  lines: string[];
  /** The box the lines take, its top left at x, y. */
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  lineH: number;
  bold: boolean;
  /** fg: what happened, a point. muted: what frames it, a period, a name.
   * accent: the focus. */
  role: "fg" | "muted" | "accent";
  /** Where in the box the lines are set. */
  anchor: "start" | "middle" | "end";
  /** Letter spacing in em: an eyebrow is tracked. */
  track: number;
};

export type TextStyle = Pick<
  PlotText,
  "kind" | "size" | "lineH" | "bold" | "role" | "track"
>;

/** width is a line's width in a style: the sans budget plus its tracking,
 * which the budget does not know about. */
export function width(line: string, s: TextStyle): number {
  return textWidth(line, s.size, "sans") + [...line].length * s.track * s.size;
}

/** measure wraps a text at max and sizes it, not yet placed. A word wider
 * than max stays whole and widens the box. */
export function measure(
  text: string,
  max: number,
  s: TextStyle,
  anchor: PlotText["anchor"] = "start",
): PlotText {
  const lines = wrapIn(text, max, s);
  const w = Math.ceil(Math.max(0, ...lines.map((l) => width(l, s))));
  return {
    ...s,
    lines,
    x: 0,
    y: 0,
    w,
    h: lines.length * s.lineH,
    anchor,
  };
}

/** wrapIn is theme's wrap measured with the style's tracking, which the
 * budget alone leaves out: a tracked line would run past its box. */
function wrapIn(text: string, max: number, s: TextStyle): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line === "" ? word : `${line} ${word}`;
      if (line !== "" && width(next, s) > max) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

/** longestWord is the widest run a text cannot be wrapped inside. */
export function longestWord(text: string, s: TextStyle): number {
  return Math.max(0, ...text.split(/\s+/).map((t) => width(t, s)));
}

/** at moves a measured text to its place. */
export function at(t: PlotText, x: number, y: number): PlotText {
  return { ...t, x, y };
}

/** An eyebrow: a diagram's title, small, tracked and muted, above it. */
export const eyebrow: TextStyle = {
  kind: "title",
  size: 11,
  lineH: 16,
  bold: true,
  role: "muted",
  track: 0.08,
};
