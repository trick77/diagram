import type { QuadrantIR } from "./ir";
import { at, eyebrow, measure, type PlotText, type TextStyle } from "./plot";
import type { Dot, Segment } from "./timeline";
import { ramp } from "./theme";

/**
 * Where everything in a 2×2 goes: a square plot in a hairline frame, an
 * axis cross through its centre with an arrowhead at each high end, the
 * axis's name beyond the tip, the quadrants' names muted in their outer
 * corners, and every point a small dot with its label beside it. No
 * filled quadrants: the position says which one a point is in.
 *
 * A label never crosses an axis or the frame: it stays in its point's
 * quadrant. It sits to the right of its dot, to the left where the right
 * has no room for it (near the right edge, or just left of the vertical
 * axis), wrapped to the wider side where neither has; and it moves up or
 * down, a few pixels at a time, off a label, a dot or a quadrant's name it
 * would cover. A label with no such spot is a chart too crowded to draw:
 * layoutQuadrant throws (Crowded).
 */

export type QuadrantDot = Dot & { focus: boolean };
export type QuadrantLayout = {
  width: number;
  height: number;
  /** The square, its top left at x, y. */
  plot: { x: number; y: number; size: number };
  /** The x axis, left to its tip, and the y axis, bottom to its tip. */
  axes: [Segment, Segment];
  dots: QuadrantDot[];
  /** From a dot to a label moved well off its height (leader). */
  leaders: Segment[];
  texts: PlotText[];
};

const margin = 32;
/** The plot's side. A label stays in its quadrant, so half of this is the
 * most a label beside a dot has: at 400 three words at a fifth of the way
 * in already wrapped. With the axis's name it is still under a 700px text
 * column. */
export const plotSize = 480;
/** The arrow runs this far past the frame; its name sits past the tip. */
const overshoot = 16;
const tipGap = 8;
/** A quadrant's name from its corner. */
const cornerX = 12;
const cornerY = 10;
/** A label from its dot's centre; the space it keeps from an axis or the
 * frame, and from another label. */
export const labelGap = 10;
const wall = 4;
const clear = 2;
/** How far a label may move off its dot's height, and by how much at a
 * time: room for four labels stacked over dots a few pixels apart, and
 * still read as beside its own. */
export const nudgeMax = 40;
const nudgeStep = 2;
/** A leader stops this short of its dot and of its label. */
const leaderGap = 2;
const dotR = 4;
const focusR = 5;
const titleGap = 14;

const axisStyle: TextStyle = {
  kind: "axis",
  size: ramp.label,
  lineH: 16,
  bold: true,
  role: "muted",
  track: 0.06,
};
const quadrantStyle: TextStyle = {
  kind: "quadrant",
  size: ramp.label,
  lineH: 15,
  bold: false,
  role: "muted",
  track: 0,
};
/** A notch under the ramp's text: a quadrant of 200px holds a label of
 * three or four words beside a dot without wrapping it. */
const pointStyle: TextStyle = {
  kind: "point",
  size: ramp.code,
  lineH: 16,
  bold: false,
  role: "fg",
  track: 0,
};

type Rect = { x: number; y: number; w: number; h: number };

export function layoutQuadrant(ir: QuadrantIR): QuadrantLayout {
  const S = plotSize;
  const texts: PlotText[] = [];
  let top = margin;
  const title = ir.title === "" ? null : measure(ir.title, S, eyebrow);
  if (title) top += title.h + titleGap;
  const yName =
    ir.yAxis === "" ? null : measure(ir.yAxis, S / 2, axisStyle, "middle");
  if (yName) top += yName.h + tipGap;
  top += overshoot;
  const px = margin;
  const py = top;
  const cx = px + S / 2;
  const cy = py + S / 2;

  if (title) texts.push(at(title, margin, margin));
  if (yName)
    texts.push(at(yName, cx - yName.w / 2, py - overshoot - tipGap - yName.h));
  const xName = ir.xAxis === "" ? null : measure(ir.xAxis, 160, axisStyle);
  if (xName)
    texts.push(at(xName, px + S + overshoot + tipGap, cy - xName.h / 2));

  // The quadrants' names in their outer corners: 1 top right, 2 top left,
  // 3 bottom left, 4 bottom right, as the source numbers them.
  const cell = S / 2 - 2 * cornerX;
  ir.quadrants.forEach((q, i) => {
    if (q === "") return;
    const right = i === 0 || i === 3;
    const t = measure(q, cell, quadrantStyle, right ? "end" : "start");
    const x = right ? px + S - cornerX - t.w : px + cornerX;
    const y = i < 2 ? py + cornerY : py + S - cornerY - t.h;
    texts.push(at(t, x, y));
  });

  const dots: QuadrantDot[] = ir.points.map((p) => ({
    x: px + clamp01(p.x) * S,
    y: py + (1 - clamp01(p.y)) * S,
    r: p.focus ? focusR : dotR,
    focus: p.focus ?? false,
  }));
  const names = texts.filter((t) => t.kind === "quadrant");
  const frame = { px, py, cx, cy, S };
  // Labels whose leaders cross nothing where there are such spots; where a
  // cluster has none, the labels alone, nudged apart, and a leader only
  // where it still crosses nothing. Crowded past that.
  let labels: PlotText[];
  try {
    labels = placeAll(ir, dots, names, frame, true);
  } catch (e) {
    if (!(e instanceof Crowded)) throw e;
    labels = placeAll(ir, dots, names, frame, false);
  }
  texts.push(...labels);
  const leaders: Segment[] = [];
  labels.forEach((t, i) => {
    const l = leader(dots[i], t);
    if (l === null) return;
    const blocks = obstacles(dots[i], [
      ...texts.filter((o) => o !== t),
      ...dots.filter((_, j) => j !== i).map(ring),
    ]);
    if (!blocks.some((o) => cuts(l, o))) leaders.push(l);
  });

  const right = xName
    ? px + S + overshoot + tipGap + xName.w
    : px + S + overshoot;
  return {
    width: Math.ceil(Math.max(right, title ? margin + title.w : 0) + margin),
    height: Math.ceil(py + S + margin),
    plot: { x: px, y: py, size: S },
    axes: [
      { x1: px, y1: cy, x2: px + S + overshoot, y2: cy },
      { x1: cx, y1: py + S, x2: cx, y2: py - overshoot },
    ],
    dots,
    leaders,
    texts,
  };
}

function ring(d: QuadrantDot): Rect {
  return { x: d.x - d.r - 1, y: d.y - d.r - 1, w: 2 * d.r + 2, h: 2 * d.r + 2 };
}

/** obstacles is what a dot's leader must not cross: everything but what
 * the dot itself already sits on (a quadrant's name in its corner), which
 * no leader from it can miss. */
function obstacles(d: QuadrantDot, all: Rect[]): Rect[] {
  return all.filter((o) => overlap(ring(d), o) === 0);
}

/** placeAll places every point's label: the focus first, so it keeps its
 * spot; the rest top to bottom, so a cluster's labels stack in the order
 * of their dots. With leaders, a spot also needs a leader to it that
 * crosses nothing, and must not lie on a leader drawn before it. */
function placeAll(
  ir: QuadrantIR,
  dots: QuadrantDot[],
  names: PlotText[],
  frame: Frame,
  leaders: boolean,
): PlotText[] {
  const order = ir.points
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(dots[b].focus) - Number(dots[a].focus) ||
        dots[a].y - dots[b].y ||
        a - b,
    );
  const taken: Rect[] = [...names];
  const drawn: Segment[] = [];
  const labels: PlotText[] = [];
  for (const i of order) {
    const d = dots[i];
    const others = dots.filter((_, j) => j !== i).map(ring);
    const t = place(ir.points[i].label, d, frame, (r) => {
      const area = [...taken, ...others].reduce(
        (a, o) => a + overlap(grow(r, clear), o),
        0,
      );
      if (!leaders) return area;
      const l = leader(d, r);
      const crossed =
        (l !== null &&
          obstacles(d, [...taken, ...others]).some((o) => cuts(l, o))) ||
        drawn.some((s) => cuts(s, grow(r, clear)));
      return area + (crossed ? 1 : 0);
    });
    labels[i] = t;
    taken.push(t);
    const l = leader(d, t);
    if (l !== null) drawn.push(l);
  }
  return labels;
}

/** leader is the hairline from a dot to its label, once the label has
 * moved off the dot's height by more than half a line: past that, in a
 * cluster, which label is whose stopped being plain. From the dot's edge
 * to the label's near side, at the nearest of its lines. */
export function leader(d: Dot, t: PlotText): Segment | null {
  const y = Math.max(t.y + t.lineH / 2, Math.min(t.y + t.h - t.lineH / 2, d.y));
  if (Math.abs(y - d.y) <= t.lineH / 2) return null;
  const right = t.x > d.x;
  const x = right ? t.x - leaderGap : t.x + t.w + leaderGap;
  const len = Math.hypot(x - d.x, y - d.y);
  const k = (d.r + leaderGap) / len;
  return {
    x1: d.x + (x - d.x) * k,
    y1: d.y + (y - d.y) * k,
    x2: x,
    y2: y,
  };
}

/** cuts says a segment, at any angle, passes through a box: clipped to
 * the box (Liang-Barsky), something of it is left. */
export function cuts(s: Segment, r: Rect): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let lo = 0;
  let hi = 1;
  const edges: [number, number][] = [
    [-dx, s.x1 - r.x],
    [dx, r.x + r.w - s.x1],
    [-dy, s.y1 - r.y],
    [dy, r.y + r.h - s.y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (lo > hi) return false;
  }
  return true;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

type Frame = { px: number; py: number; cx: number; cy: number; S: number };

/** place sets a point's label: the side with room, then the nearest height
 * to the dot's that covers nothing, within its quadrant. covered is how
 * much of what is already placed a spot would cover. */
function place(
  label: string,
  d: QuadrantDot,
  f: Frame,
  covered: (r: PlotText) => number,
): PlotText {
  const style: TextStyle = d.focus
    ? { ...pointStyle, bold: true, role: "accent" }
    : pointStyle;
  // The quadrant's inside, short of its axis and its frame by a wall.
  const left = d.x < f.cx;
  const lo = (left ? f.px : f.cx) + wall;
  const hi = (left ? f.cx : f.px + f.S) - wall;
  const upper = d.y < f.cy;
  const top = (upper ? f.py : f.cy) + wall;
  const bottom = (upper ? f.cy : f.py + f.S) - wall;
  const roomR = hi - (d.x + labelGap);
  const roomL = d.x - labelGap - lo;

  const one = measure(label, Infinity, style);
  const sides: { side: "right" | "left"; t: PlotText }[] = [];
  if (one.w <= roomR) sides.push({ side: "right", t: one });
  if (one.w <= roomL)
    sides.push({ side: "left", t: { ...one, anchor: "end" } });
  if (sides.length === 0) {
    const side = roomR >= roomL ? "right" : "left";
    const t = measure(
      label,
      Math.max(roomR, roomL),
      style,
      side === "left" ? "end" : "start",
    );
    // A word wider than the quadrant's room would cross its axis.
    if (t.w > Math.max(roomR, roomL)) throw new Crowded(label);
    sides.push({ side, t });
  }
  const xOf = (s: (typeof sides)[number]) =>
    s.side === "right" ? d.x + labelGap : d.x - labelGap - s.t.w;
  const yAt = (t: PlotText, dy: number) =>
    Math.max(top, Math.min(bottom - t.h, d.y - t.h / 2 + dy));
  // Nearest the dot's own height first, on the preferred side; then the
  // other side.
  for (const s of sides) {
    for (let k = 0; k <= nudgeMax / nudgeStep; k++) {
      for (const dy of k === 0 ? [0] : [-k * nudgeStep, k * nudgeStep]) {
        const r = at(s.t, xOf(s), yAt(s.t, dy));
        if (covered(r) === 0) return r;
      }
    }
  }
  throw new Crowded(label);
}

/** Crowded is a label with no spot that covers nothing, in reach of its
 * dot and inside its quadrant. Thrown rather than drawn over another:
 * ./mermaid then has the renderer draw the chart, and a crowded drawing of
 * ours would be no better than its. */
export class Crowded extends Error {
  constructor(label: string) {
    super(`quadrant: no room for the label "${label}"`);
    this.name = "Crowded";
  }
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

/** overlap is the area two boxes share. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
