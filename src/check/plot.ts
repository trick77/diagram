import type { PlotText } from "../plot";
import { width } from "../plot";
import type { Segment, TimelineLayout } from "../timeline";
import { cuts, type QuadrantLayout } from "../quadrant";

/**
 * The quality gate of the drawings without boxes, a timeline and a
 * quadrant: every text inside its own box and inside the canvas, no two
 * texts on one another, none struck through by a line, every dot where it
 * belongs. Returns what is wrong, in words, empty when nothing is.
 */

type Rect = { x: number; y: number; w: number; h: number };

/** checkTimeline holds a timeline to it: no text on the line, a drop or a
 * section's rule, and every dot on the line. */
export function checkTimeline(l: TimelineLayout): string[] {
  const out = texts(l.texts, l);
  const lines = [l.line, ...l.drops, ...l.rules];
  for (const t of l.texts) {
    if (lines.some((s) => struck(t, s)))
      out.push(`${name(t)}: a line runs through it`);
  }
  l.dots.forEach((d, i) => {
    if (distance(d, l.line) > 0.5) out.push(`dot ${i}: off the line`);
  });
  return out;
}

/** checkQuadrant holds a quadrant to it: no text on an axis or the frame,
 * no point's label over a dot, and every dot inside the plot. */
export function checkQuadrant(l: QuadrantLayout): string[] {
  const out = texts(l.texts, l);
  const p = l.plot;
  const frame: Segment[] = [
    { x1: p.x, y1: p.y, x2: p.x + p.size, y2: p.y },
    { x1: p.x, y1: p.y + p.size, x2: p.x + p.size, y2: p.y + p.size },
    { x1: p.x, y1: p.y, x2: p.x, y2: p.y + p.size },
    { x1: p.x + p.size, y1: p.y, x2: p.x + p.size, y2: p.y + p.size },
  ];
  for (const t of l.texts) {
    if ([...l.axes, ...frame].some((s) => struck(t, s)))
      out.push(`${name(t)}: crosses an axis or the frame`);
    if (t.kind !== "point") continue;
    l.dots.forEach((d, i) => {
      if (overlaps(t, { x: d.x - d.r, y: d.y - d.r, w: 2 * d.r, h: 2 * d.r }))
        out.push(`${name(t)}: over dot ${i}`);
    });
  }
  l.dots.forEach((d, i) => {
    if (d.x < p.x || d.x > p.x + p.size || d.y < p.y || d.y > p.y + p.size)
      out.push(`dot ${i}: outside the plot`);
  });
  // A leader ends short of its own label and starts short of its dot: it
  // passes through no text and no dot, but a text its own dot sits on,
  // which no leader from that dot can miss.
  l.leaders.forEach((s, i) => {
    const box = (d: { x: number; y: number; r: number }) => ({
      x: d.x - d.r,
      y: d.y - d.r,
      w: 2 * d.r,
      h: 2 * d.r,
    });
    const own = l.dots.reduce((a, d) =>
      Math.hypot(d.x - s.x1, d.y - s.y1) < Math.hypot(a.x - s.x1, a.y - s.y1)
        ? d
        : a,
    );
    for (const t of l.texts)
      if (!overlaps(box(own), t) && cuts(s, t))
        out.push(`leader ${i}: runs through ${name(t)}`);
    l.dots.forEach((d, j) => {
      if (cuts(s, box(d))) out.push(`leader ${i}: runs through dot ${j}`);
    });
  });
  return out;
}

/** texts holds every text to its box and the canvas, and apart from every
 * other one. */
function texts(all: PlotText[], canvas: { width: number; height: number }) {
  const out: string[] = [];
  all.forEach((t, i) => {
    for (const line of t.lines) {
      if (width(line, t) > t.w + 0.5)
        out.push(`${name(t)}: "${line}" overflows its box`);
    }
    if (t.h < t.lines.length * t.lineH)
      out.push(`${name(t)}: its lines overflow its box`);
    if (
      t.x < 0 ||
      t.y < 0 ||
      t.x + t.w > canvas.width ||
      t.y + t.h > canvas.height
    )
      out.push(`${name(t)}: runs past the canvas`);
    for (const u of all.slice(i + 1)) {
      if (overlaps(t, u)) out.push(`${name(t)} and ${name(u)}: overlap`);
    }
  });
  return out;
}

const name = (t: PlotText) => `${t.kind} "${t.lines.join(" ")}"`;

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** struck says an axis-aligned line runs through a text's box. */
function struck(r: Rect, s: Segment): boolean {
  const x0 = Math.min(s.x1, s.x2);
  const x1 = Math.max(s.x1, s.x2);
  const y0 = Math.min(s.y1, s.y2);
  const y1 = Math.max(s.y1, s.y2);
  return x1 >= r.x && x0 <= r.x + r.w && y1 >= r.y && y0 <= r.y + r.h;
}

/** distance from a point to a segment. */
function distance(p: { x: number; y: number }, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = dx * dx + dy * dy;
  const k =
    len === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len));
  return Math.hypot(p.x - (s.x1 + k * dx), p.y - (s.y1 + k * dy));
}
