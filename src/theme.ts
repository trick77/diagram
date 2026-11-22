/**
 * The look of the diagrams, which is not the app chrome's: a palette, the
 * IBM Plex pair and the type sizes of an engineering-memo reference design
 * (the --diagram-* tokens the app's stylesheet defines). Plus the text
 * measure the layout sizes boxes by.
 *
 * Roles, not values: the drawing asks for `fg` or `line`, and the app's
 * stylesheet says what that is.
 */

export type Palette = {
  /** The canvas and a box's fill. */
  surface: string;
  fg: string;
  /** Arrows, arrow labels, secondary text. */
  muted: string;
  /** Every frame. */
  line: string;
  /** An outcome's fill and a zone's wash. */
  tint: string;
  /** The focus: what the question is about, tagged `:::focus`. */
  accent: string;
  /** A boundary: a dotted arrow in the source, async or optional. */
  warn: string;
  sans: string;
  mono: string;
};

/** Read off the document like ./mermaid themeVariables(): the drawing
 * is a string of SVG, and a downloaded file has no stylesheet to resolve
 * var() against, so every value goes in resolved. */
const roles: Record<keyof Palette, string> = {
  surface: "--diagram-surface",
  fg: "--diagram-fg",
  muted: "--diagram-muted",
  line: "--diagram-line",
  tint: "--diagram-tint",
  accent: "--diagram-accent",
  warn: "--diagram-warn",
  sans: "--diagram-sans",
  mono: "--diagram-mono",
};

/** palette is the roles resolved. A token the document lacks (jsdom loads
 * no stylesheet) stays a var() reference, which still draws on the page. */
export function palette(): Palette {
  const style =
    typeof getComputedStyle === "function"
      ? getComputedStyle(document.documentElement)
      : null;
  const out = {} as Palette;
  for (const [role, token] of Object.entries(roles) as [
    keyof Palette,
    string,
  ][]) {
    const v = style?.getPropertyValue(token).trim() ?? "";
    out[role] = v !== "" ? v : `var(${token})`;
  }
  return out;
}

/** mix is a laid over b at t (0..1), as hex, or null when either is not an
 * opaque hex or rgb() value (a var() under jsdom, a named colour, hsl(), a
 * see-through colour, which would mix over black). Mixed here, not with
 * color-mix(): the drawing travels on as a file with no stylesheet, and an
 * SVG viewer outside a browser draws no color-mix(). */
export function mix(a: string, b: string, t: number): string | null {
  const p = rgb(a);
  const q = rgb(b);
  if (p === null || q === null) return null;
  const k = Math.min(1, Math.max(0, t));
  const hex = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return "#" + p.map((v, i) => hex(v * k + q[i] * (1 - k))).join("");
}

function rgb(c: string): number[] | null {
  const s = c.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (short) return short.slice(1).map((h) => parseInt(h + h, 16));
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(ff)?$/i.exec(s);
  if (long) return long.slice(1, 4).map((h) => parseInt(h, 16));
  const fn =
    /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(
      s,
    );
  if (!fn) return null;
  const alpha = fn[4];
  if (
    alpha !== undefined &&
    parseFloat(alpha) !== (alpha.endsWith("%") ? 100 : 1)
  )
    return null;
  return fn.slice(1, 4).map((v) => Math.min(255, Number(v)));
}

/** frameOf is the frame of a box that carries the picture (a step, a
 * decision, a participant, a table, a start or an end): 45% of the text
 * over the surface. In the line colour it sat fainter than the arrows
 * joining it (README dark: line 1.6:1, muted 6.8:1); this draws about 4:1.
 * A palette it cannot read (var()s) gets the arrows' muted. */
export function frameOf(pal: Palette): string {
  return mix(pal.fg, pal.surface, 0.45) ?? pal.muted;
}

/** focusFillOf is a focus box's ground, 11% of the accent over the
 * surface, or null where the palette cannot be read: the caller then keeps
 * the plain ground and marks the focus by a heavier frame instead. */
export function focusFillOf(pal: Palette, over = pal.surface): string | null {
  return mix(pal.accent, over, 0.11);
}

/** focusWeight is a focus frame's stroke: 1.4 over its tint, 2 where there
 * is no tint to carry it. */
export function focusWeight(pal: Palette): number {
  return focusFillOf(pal) === null ? 2 : 1.4;
}

/** The type ramp, in px, the reference's own: a node in the sans, a start or an
 * end in its bold, a name from the code in the mono, a field or a period in
 * the smaller mono. An arrow's text is a note on the line, a step below the
 * names it joins: prose in tracked mono capitals (`arrow`), a name from the
 * code as written (`arrowCode`). At the label size the arrows' words
 * competed with the boxes. Drawn 1:1 at most: a diagram wider than its text
 * is scaled down to it, never scrolled, and read at size in the full view. */
export const ramp = {
  text: 13,
  bold: 13.5,
  code: 12,
  label: 11.5,
  arrow: 10,
  arrowCode: 11,
  lineHeight: 18,
} as const;

/** An arrow note's letter-spacing, in em: capitals set solid read as
 * shouting. */
export const arrowTrack = 0.08;

export type Face = "sans" | "mono";

/** Advance per character, in em, measured in Chrome with the self-hosted
 * faces loaded (canvas measureText over real labels, width / size / chars,
 * 2026-10-25): the mono is exactly 0.6 at 12px; IBM Plex Sans 0.46 to 0.50
 * at 400/13px and up to 0.52 at 600/13.5px (worst case `WWWWMMMM mmmm`
 * 0.81, best `iiii llll` 0.26). Budgeted at 0.56, so a box is never short
 * for a real label; the 16px padding each side absorbs the wide-letter
 * case. The first budget, 0.6 for both faces, wrapped every box on the
 * main path a line early. A budget rather than a measurement on the page
 * because it is the same under jsdom, where text has no width, and before
 * the web font has loaded, so a layout is a function of its text alone. */
const advance: Record<Face, number> = { sans: 0.56, mono: 0.6 };
/** A sans capital, measured at 0.60 to 0.66 per letter (A-Z 0.63 at 400,
 * 0.66 at 600): at the lowercase budget a label in capitals ran about 15%
 * past its box. */
const capital = 0.68;

/** textWidth is the width a string takes at a size: a wide or full-width
 * character costs 1em, a mark nothing, any other character its face's
 * advance, and every character the letter-spacing track (em) on top. */
export function textWidth(
  s: string,
  size: number,
  face: Face,
  track = 0,
): number {
  let em = 0;
  for (const ch of s) {
    if (/\p{M}/u.test(ch)) continue;
    em +=
      track +
      (wide(ch)
        ? 1
        : face === "sans" && /\p{Lu}/u.test(ch)
          ? capital
          : advance[face]);
  }
  return em * size;
}

function wide(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  );
}

/** wrap breaks a label into lines no wider than max, at spaces, keeping the
 * label's own line breaks. A word wider than max stays whole on its own
 * line; the caller sees it in the width and picks a wider box. */
export function wrap(
  s: string,
  max: number,
  size: number,
  face: Face,
  track = 0,
): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line === "" ? word : `${line} ${word}`;
      if (line !== "" && textWidth(next, size, face, track) > max) {
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
