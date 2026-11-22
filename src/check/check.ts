import type { FlowLayout, NodeBox, Point } from "../layout";
import { dotted, titleRoom } from "../layout";
import { markRoom, tablePad, type ERLayout } from "../er";
import type { MindmapLayout } from "../mindmap";
import {
  boxPad,
  nestInset,
  notePad,
  type SeqLifeline,
  type SequenceLayout,
} from "../sequence";
import { ramp, textWidth } from "../theme";
import {
  compPad,
  emptyComp,
  headPad,
  memberLine,
  stereoLine,
  type ClassLayout,
  type MemberLines,
} from "../class";
import { eyebrowWidth, titlePad, type SwimlaneLayout } from "../swimlane";

/**
 * A layout's quality gate as code, checked on a computed layout: every
 * arrow straight or bent at right angles, leaving and entering a box square
 * to its edge; never behind a box it does not connect; no two arrows on one
 * stretch of line or one attach point, and none crossing another; every
 * label clear of its line and of every box; every label inside its box.
 * The package's corpus test runs it over every corpus diagram, and each
 * consumer's corpus test over its own, so a layout change that breaks one
 * fails a test rather than a picture.
 *
 * Returns what is wrong, in words, empty when nothing is.
 */

type Rect = { x: number; y: number; w: number; h: number };

/** The least clear space between a label and its own line. */
export const minLabelGap = 6;

/** A mapping keeps both its columns in the order written, so an arrow
 * crossing another is the mapping's own: its caller says so with
 * `written`, and the crossing rule is not held against it. */
export function check(
  l: FlowLayout,
  opts: { written?: boolean } = {},
): string[] {
  const out: string[] = [];
  const byId = new Map(l.nodes.map((n) => [n.id, n]));

  for (const z of l.zones) {
    if (titleRoom(z.title) > z.w) out.push(`${z.id}: title overflows its zone`);
  }

  for (const n of l.nodes) {
    if (n.kind === "decision") continue;
    for (const line of n.lines) {
      if (textWidth(line, n.size, n.face) > n.w - 32)
        out.push(`${n.id}: "${line}" overflows its box`);
    }
  }

  l.edges.forEach((e, i) => {
    const name = `${e.from}->${e.to}`;
    if (e.points.length < 2) {
      out.push(`${name}: no route`);
      return;
    }
    for (const [a, b] of segments(e.points)) {
      if (a.x !== b.x && a.y !== b.y) out.push(`${name}: diagonal segment`);
    }
    const from = byId.get(e.from)!;
    const to = byId.get(e.to)!;
    const first = e.points[0];
    const last = e.points[e.points.length - 1];
    if (dotted(from.kind)) {
      if (!onOutline(from, first)) out.push(`${name}: misses ${e.from}`);
    } else if (
      from.kind !== "decision" &&
      !perpendicular(from, first, e.points[1])
    )
      out.push(`${name}: leaves ${e.from} along its border`);
    if (dotted(to.kind)) {
      if (!onOutline(to, last)) out.push(`${name}: misses ${e.to}`);
    } else if (
      to.kind !== "decision" &&
      !perpendicular(to, last, e.points[e.points.length - 2])
    )
      out.push(`${name}: enters ${e.to} along its border`);

    // Rule 5: never behind a box that is not an end.
    for (const n of l.nodes) {
      if (n.id === e.from || n.id === e.to) continue;
      if (segments(e.points).some(([a, b]) => crosses(a, b, inset(n, 1))))
        out.push(`${name}: passes behind ${n.id}`);
    }

    if (e.label) {
      const m = e.label;
      // Rule 2: the label clear of its own line.
      const d = Math.min(
        ...segments(e.points).map(([a, b]) => distance(m, a, b)),
      );
      if (d < minLabelGap) out.push(`${name}: label ${d}px from its line`);
      // Rule 6: the label clear of every box.
      for (const n of l.nodes) {
        if (overlaps(m, n)) out.push(`${name}: label over ${n.id}`);
      }
    }

    // Rules 3 and 4: no two connectors share a stretch or an end point.
    for (const f of l.edges.slice(i + 1)) {
      const other = `${f.from}->${f.to}`;
      // On an org chart's bus, edges out of one node share the drop and
      // the line along the row by design; only where they end is theirs.
      const bus = l.bus === true && e.from === f.from;
      if (
        !bus &&
        segments(e.points).some(([a, b]) =>
          segments(f.points).some(([c, d]) => collinear(a, b, c, d)),
        )
      )
        out.push(`${name} and ${other}: run on top of each other`);
      const ends = [e.points[e.points.length - 1]];
      const fends = [f.points[f.points.length - 1]];
      if (!bus) {
        ends.push(e.points[0]);
        fends.push(f.points[0]);
      }
      if (ends.some((p) => fends.some((q) => p.x === q.x && p.y === q.y)))
        out.push(`${name} and ${other}: share an attach point`);
      // No two connectors cross: a person drawing it would have swapped
      // the branches instead.
      if (
        !opts.written &&
        segments(e.points).some(([a, b]) =>
          segments(f.points).some(([c, d]) => cut(a, b, c, d)),
        )
      )
        out.push(`${name} and ${other}: cross`);
      if (e.label && f.label && overlaps(e.label, f.label))
        out.push(`${name} and ${other}: labels overlap`);
    }
  });
  return out;
}

/** checkER holds an entity model to the flow's connector rules, every text
 * inside its table, and each line's ends straight for long enough to
 * carry their cardinality marks. No two relationships crossing is one of
 * those rules on purpose: the engine places the tables free of any written
 * order, so a crossing it leaves reads as badly as a flowchart's. */
export function checkER(l: ERLayout): string[] {
  const out = check(l);
  for (const n of l.nodes) {
    const t = l.tables.get(n.id)!;
    for (const line of t.name.lines) {
      if (textWidth(line, t.name.size, t.name.face) > n.w - 2 * tablePad)
        out.push(`${n.id}: its name overflows its table`);
    }
    for (const r of t.rows) {
      for (const c of r.cells) {
        for (const line of c.text) {
          if (c.x + textWidth(line, c.size, c.face) > n.w - tablePad)
            out.push(`${n.id}: "${line}" overflows its table`);
        }
      }
    }
  }
  for (const e of l.edges) {
    const p = e.points;
    if (p.length < 2) continue;
    const first = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    const n = p.length;
    const last = Math.hypot(p[n - 1].x - p[n - 2].x, p[n - 1].y - p[n - 2].y);
    if (Math.min(first, last) < markRoom)
      out.push(`${e.from}->${e.to}: an end too short for its mark`);
  }
  return out;
}

/** checkMindmap holds a mindmap to the rules that still apply where the
 * connectors are curves: every text inside its box, no two boxes on one
 * another, no curve behind a box it does not connect, no two curves
 * crossing (two leaving one point is a fan, not a crossing), and nothing
 * past the canvas. A curve is checked as the polyline it is sampled to. */
export function checkMindmap(l: MindmapLayout): string[] {
  const out: string[] = [];
  for (const n of l.nodes) {
    for (const line of n.lines) {
      if (textWidth(line, n.size, n.face) > n.w - 2 * n.padX)
        out.push(`${n.id}: "${line}" overflows its box`);
    }
    if (n.x < 0 || n.y < 0 || n.x + n.w > l.width || n.y + n.h > l.height)
      out.push(`${n.id}: runs past the canvas`);
  }
  l.nodes.forEach((n, i) => {
    for (const m of l.nodes.slice(i + 1)) {
      if (overlaps(n, m)) out.push(`${n.id} and ${m.id}: overlap`);
    }
  });
  const paths = l.links.map((k) => sample(k.points));
  l.links.forEach((k, i) => {
    const name = `${k.from}->${k.to}`;
    for (const n of l.nodes) {
      if (n.id === k.from || n.id === k.to) continue;
      if (segments(paths[i]).some(([a, b]) => clips(a, b, inset(n, 1))))
        out.push(`${name}: passes behind ${n.id}`);
    }
    l.links.slice(i + 1).forEach((m, j) => {
      // Where two curves share an end they meet there by design: a fan.
      const shared = [k.points[0], k.points[3]].filter((p) =>
        [m.points[0], m.points[3]].some((q) => near(p, q)),
      );
      const hit = segments(paths[i]).some(([a, b]) =>
        segments(paths[i + 1 + j]).some(([c, d]) => {
          const x = meet(a, b, c, d);
          return x !== null && !shared.some((p) => near(p, x, 1.5));
        }),
      );
      if (hit) out.push(`${name} and ${m.from}->${m.to}: cross`);
    });
  });
  return out;
}

/** checkSwimlane holds a swimlane to the flow's connector rules, every
 * step inside its own lane's band and right of the header, every lane's
 * name inside the header, and the lanes stacked without a gap. Lanes keep
 * the order written, as a mapping's columns do, so a handoff crossing an
 * arrow along a lane can be the lanes' own: crossings are not held
 * against it. */
export function checkSwimlane(l: SwimlaneLayout): string[] {
  const out = check(l, { written: true });
  const byId = new Map(l.nodes.map((n) => [n.id, n]));
  l.lanes.forEach((lane, i) => {
    if (i > 0) {
      const above = l.lanes[i - 1];
      if (lane.y !== above.y + above.h)
        out.push(`${lane.id}: not right under ${above.id}`);
    }
    for (const line of lane.lines)
      if (eyebrowWidth(line) > l.head - 2 * titlePad)
        out.push(`${lane.id}: its name overflows the header`);
    if (lane.lines.length * 16 > lane.h)
      out.push(`${lane.id}: its name is taller than its lane`);
    for (const id of lane.nodes) {
      const n = byId.get(id)!;
      if (
        n.y < lane.y ||
        n.y + n.h > lane.y + lane.h ||
        n.x < lane.x + l.head ||
        n.x + n.w > lane.x + lane.w
      )
        out.push(`${id}: outside its lane ${lane.id}`);
    }
  });
  return out;
}

/** checkClass holds a class diagram to the flow's connector rules, every
 * line inside its class and every compartment tall enough for its lines,
 * each line's ends straight for long enough to carry their marks, and each
 * multiplicity clear of every box, every line and every other text. */
export function checkClass(l: ClassLayout): string[] {
  const out = check(l);
  for (const n of l.nodes) {
    const c = l.classes.get(n.id)!;
    const room = n.w - 2 * tablePad;
    const over = (line: string, size: number, face: "sans" | "mono") =>
      textWidth(line, size, face) > room;
    for (const line of c.name)
      if (over(line, ramp.bold, "sans"))
        out.push(`${n.id}: its name overflows its class`);
    if (c.stereotype && over(c.stereotype, ramp.label, "sans"))
      out.push(`${n.id}: its stereotype overflows its class`);
    for (const m of [...c.fields, ...c.methods])
      for (const line of m.lines)
        if (over(line, ramp.label, "mono"))
          out.push(`${n.id}: "${line}" overflows its class`);
    const need = (ms: MemberLines[]) => {
      const k = ms.reduce((s, m) => s + m.lines.length, 0);
      return k === 0 ? emptyComp : k * memberLine + 2 * compPad;
    };
    const head =
      2 * headPad +
      (c.stereotype ? stereoLine : 0) +
      c.name.length * ramp.lineHeight;
    if (
      c.head < head ||
      c.fieldsH < need(c.fields) ||
      c.methodsH < need(c.methods)
    )
      out.push(`${n.id}: a compartment is short for its lines`);
    if (c.head + c.fieldsH + c.methodsH > n.h)
      out.push(`${n.id}: its compartments run past its box`);
  }
  const cards: { name: string; r: Rect }[] = [];
  l.edges.forEach((e, i) => {
    const name = `${e.from}->${e.to}`;
    const p = e.points;
    if (p.length >= 2) {
      const n = p.length;
      const first = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      const last = Math.hypot(p[n - 1].x - p[n - 2].x, p[n - 1].y - p[n - 2].y);
      if (Math.min(first, last) < markRoom)
        out.push(`${name}: an end too short for its mark`);
    }
    const { from, to } = l.ends[i];
    if (from.card) cards.push({ name: `${name} at ${e.from}`, r: from.card });
    if (to.card) cards.push({ name: `${name} at ${e.to}`, r: to.card });
  });
  const labels = l.edges.flatMap((e) =>
    e.label ? [{ name: `${e.from}->${e.to}`, r: e.label }] : [],
  );
  cards.forEach((c, i) => {
    for (const n of l.nodes)
      if (overlaps(c.r, n)) out.push(`${c.name}: multiplicity over ${n.id}`);
    for (const e of l.edges) {
      const d = Math.min(
        ...segments(e.points).map(([a, b]) => distance(c.r, a, b)),
      );
      if (d < minLabelGap)
        out.push(`${c.name}: multiplicity ${d}px from ${e.from}->${e.to}`);
    }
    for (const u of [...cards.slice(i + 1), ...labels])
      if (overlaps(c.r, u.r))
        out.push(`${c.name}: multiplicity overlaps ${u.name}`);
  });
  return out;
}

/** sample is a cubic curve as a polyline, fine enough that a box or another
 * curve it misses by a pixel stays missed. */
function sample(p: [Point, Point, Point, Point], n = 32): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    out.push({
      x: w.reduce((a, c, k) => a + c * p[k].x, 0),
      y: w.reduce((a, c, k) => a + c * p[k].y, 0),
    });
  }
  return out;
}

const near = (p: Point, q: Point, by = 0.5) =>
  Math.abs(p.x - q.x) <= by && Math.abs(p.y - q.y) <= by;

/** meet is where two segments of any slope cross, or null. */
function meet(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/** clips says a segment of any slope enters the inside of a rect
 * (Liang-Barsky: the segment cut down to each of the rect's sides in turn,
 * and whatever is left is inside). */
function clips(a: Point, b: Point, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sides: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
}

/** checkSequence holds a sequence layout to the same taste: every text
 * inside its box, a message's text clear of its own line, no two texts on
 * one another or on a box, a loop's text and a note beside a lifeline
 * clear of every other lifeline (a message's text crossing one is masked
 * by its ground, a loop's is not), every frame wide enough for its title,
 * its dividers clear of the text above them, any other frame either apart
 * from it or inset inside it, and nothing past the canvas. */
export function checkSequence(l: SequenceLayout): string[] {
  const out: string[] = [];
  for (const a of l.actors) {
    for (const line of a.lines) {
      if (textWidth(line, a.size, a.face) > a.w - 2 * boxPad)
        out.push(`${a.id}: "${line}" overflows its box`);
    }
  }
  l.notes.forEach((n, i) => {
    for (const line of n.lines) {
      if (textWidth(line, ramp.text, "sans") > n.w - 2 * notePad)
        out.push(`note ${i}: "${line}" overflows its box`);
    }
  });

  const texts: { name: string; r: Rect }[] = [];
  l.messages.forEach((m, i) => {
    const name = `${m.from}->${m.to} (${i})`;
    if (!m.label) return;
    const d = Math.min(
      ...segments(m.points).map(([a, b]) => distance(m.label!, a, b)),
    );
    if (d < minLabelGap) out.push(`${name}: label ${d}px from its line`);
    texts.push({ name, r: m.label });
    if (m.self) {
      for (const ln of l.lifelines) {
        if (ln.id !== m.from && spansLifeline(m.label, ln))
          out.push(`${name}: label crosses ${ln.id}'s lifeline`);
      }
    }
  });
  l.frames.forEach((f, i) => {
    texts.push({ name: `frame ${i} title`, r: f.title });
    f.dividers.forEach((d, j) => {
      if (d.label) texts.push({ name: `frame ${i} divider ${j}`, r: d.label });
    });
    if (f.title.x + f.title.w > f.x + f.w)
      out.push(`frame ${i}: title overflows its frame`);
    // A divider is a line across the frame: clear of the title and of the
    // divider text above it, which are both drawn on top of it.
    f.dividers.forEach((d, j) => {
      const above = [
        f.title,
        ...f.dividers.slice(0, j).flatMap((e) => (e.label ? [e.label] : [])),
      ];
      if (above.some((r) => d.y < r.y + r.h + 2))
        out.push(`frame ${i} divider ${j}: runs into the text above it`);
    });
    // A later frame either clears this one or sits inside it: inset on
    // every side, and clear of its dividers and of the title and divider
    // texts painted over every frame. Frames open in source order, so a
    // frame inside comes after the one holding it.
    l.frames.slice(i + 1).forEach((g, k) => {
      if (!overlaps(f, g)) return;
      const name = `frame ${i + 1 + k}`;
      if (!contains(inset(f, nestInset), g)) {
        out.push(`${name}: overlaps frame ${i} without sitting inside it`);
        return;
      }
      if (f.dividers.some((d) => d.y >= g.y && d.y <= g.y + g.h))
        out.push(`${name}: a divider of frame ${i} runs through it`);
      const above = [f.title, ...f.dividers.flatMap((d) => d.label ?? [])];
      if (above.some((r) => overlaps(r, g)))
        out.push(`${name}: runs under a text of frame ${i}`);
    });
  });
  l.notes.forEach((n, i) => {
    texts.push({ name: `note ${i}`, r: n });
    if (n.beside === undefined) return;
    // A note over lifelines covers them on purpose; one beside a lifeline
    // must not land on the next.
    for (const ln of l.lifelines) {
      if (ln.id !== n.beside && spansLifeline(n, ln))
        out.push(`note ${i}: crosses ${ln.id}'s lifeline`);
    }
  });

  texts.forEach((t, i) => {
    for (const a of l.actors) {
      if (overlaps(t.r, a)) out.push(`${t.name}: label over ${a.id}`);
    }
    for (const u of texts.slice(i + 1)) {
      if (overlaps(t.r, u.r))
        out.push(`${t.name} and ${u.name}: labels overlap`);
    }
  });

  const all: Rect[] = [
    ...l.actors,
    ...l.notes,
    ...l.frames,
    ...texts.map((t) => t.r),
  ];
  for (const r of all) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > l.width || r.y + r.h > l.height)
      out.push(`a box at ${r.x},${r.y} runs past the canvas`);
  }
  return out;
}

/** contains says r lies wholly inside outer. */
function contains(outer: Rect, r: Rect): boolean {
  return (
    r.x >= outer.x &&
    r.y >= outer.y &&
    r.x + r.w <= outer.x + outer.w &&
    r.y + r.h <= outer.y + outer.h
  );
}

function spansLifeline(r: Rect, ln: SeqLifeline): boolean {
  return r.x < ln.x && ln.x < r.x + r.w && r.y < ln.y2 && r.y + r.h > ln.y1;
}

function segments(points: Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1], points[i]]);
  return out;
}

/** onOutline says an end touches a dot's circle, within the rounding of a
 * pixel either way. */
function onOutline(n: NodeBox, p: Point): boolean {
  const d = Math.hypot(p.x - (n.x + n.w / 2), p.y - (n.y + n.h / 2));
  return Math.abs(d - n.w / 2) <= 1.5;
}

/** perpendicular says the first segment leaves the box straight out of the
 * edge its end lies on, not along it. */
function perpendicular(n: NodeBox, end: Point, next: Point): boolean {
  const onSide = end.x === n.x || end.x === n.x + n.w;
  const onTopBottom = end.y === n.y || end.y === n.y + n.h;
  if (onSide && !onTopBottom) return end.y === next.y;
  if (onTopBottom && !onSide) return end.x === next.x;
  return false;
}

function inset(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: r.w - 2 * by, h: r.h - 2 * by };
}

/** crosses says an axis-aligned segment enters the inside of a rect. */
function crosses(a: Point, b: Point, r: Rect): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
}

/** cut says a horizontal and a vertical segment cross inside both: one
 * meeting the other at an end is not a crossing. */
function cut(a: Point, b: Point, c: Point, d: Point): boolean {
  const h1 = a.y === b.y;
  if (h1 === (c.y === d.y)) return false;
  const [h, v] = h1
    ? [
        [a, b],
        [c, d],
      ]
    : [
        [c, d],
        [a, b],
      ];
  const within = (p: number, q: number, r: number) =>
    p > Math.min(q, r) && p < Math.max(q, r);
  return within(v[0].x, h[0].x, h[1].x) && within(h[0].y, v[0].y, v[1].y);
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** distance from a rect to an axis-aligned segment. */
function distance(r: Rect, a: Point, b: Point): number {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const dx = Math.max(r.x - x1, x0 - (r.x + r.w), 0);
  const dy = Math.max(r.y - y1, y0 - (r.y + r.h), 0);
  return Math.hypot(dx, dy);
}

/** collinear says two axis-aligned segments share a stretch of one line. */
function collinear(a: Point, b: Point, c: Point, d: Point): boolean {
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
    const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
    return hi > lo;
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
    return hi > lo;
  }
  return false;
}
