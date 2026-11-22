import type {
  EdgeRoute,
  FlowLayout,
  LabelBox,
  NodeBox,
  Point,
  ZoneBox,
} from "./layout";
import {
  keywordGap,
  notePad,
  type SeqActor,
  type SeqFrame,
  type SeqMessage,
  type SeqNote,
  type SequenceLayout,
  type TextBlock,
} from "./sequence";
import { ramp, textWidth, type Palette } from "./theme";
import type { Card } from "./ir";
import { rowLine, rowPad, tablePad, type ERLayout, type Table } from "./er";
import type { MindBox, MindmapLayout } from "./mindmap";
import type { PlotText } from "./plot";
import type { Segment, TimelineLayout } from "./timeline";
import type { QuadrantLayout } from "./quadrant";
import {
  compPad,
  headPad,
  markLength,
  memberLine,
  stereoLine,
  type ClassBox,
  type ClassLayout,
  type Mark,
  type MemberLines,
} from "./class";
import { titlePad, type SwimlaneLayout } from "./swimlane";

/**
 * A layout written as SVG, in the reference design's vocabulary: a canvas in
 * the surface colour with no line round it, boxes framed in the line colour with
 * a 6px corner, flat diamonds, an outcome in the tint, a zone as a tinted
 * frame titled in bold, arrows in the muted colour with a filled head that
 * stops just short of the box, and labels in the small mono beside their
 * line.
 *
 * A string, not elements: every drawing travels on as an SVG string, the
 * mermaid renderer's and this one alike, so the card, the full view,
 * an app's own pages and the file all take it unchanged. The string is built
 * here and nowhere else, and every piece of model text goes through esc, so
 * a label is text in the picture whatever characters it holds.
 *
 * Paint order: canvas, zones, arrows, labels, nodes.
 */

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

type Attrs = Record<string, string | number | undefined>;

function el(tag: string, attrs: Attrs, body?: string): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");
  return body === undefined ? `<${tag}${a}/>` : `<${tag}${a}>${body}</${tag}>`;
}

/** How far an arrow stops short of the box it points at, so the head
 * touches the frame rather than burying its tip in it. */
const headGap = 4;
/** How far a sequence's arrow stops short of its lifeline: the head's tip
 * overshoots the line's end by about this much at a 1.4 stroke. */
const tipGap = 1;

const f = (v: number) => +v.toFixed(1);

/** The radius of a connector's bend: a sharp corner read as a drafting
 * line, a quarter arc as a route. */
const bendRadius = 8;
/** How much of a run before an arrowhead stays straight: a 7-unit head at
 * a 1.4 stroke is about 10px long. */
const headRun = 10;
/** An entity line's straight end, by the cardinality drawn on it (mark's
 * reach, plus 2): a bar pair 13px, a crow's foot and its ring 22. */
const markRun: Record<Card, number> = {
  one: 15,
  zeroOrOne: 23,
  oneOrMore: 18,
  zeroOrMore: 24,
};
/** A self message's bend: its loop is 20px tall. */
const selfBend = 6;

/** route is a connector as path data: straight runs joined by quarter arcs
 * of radius r. An arc takes at most half of a run it shares with another
 * bend, and leaves keep[0] at the start and keep[1] at the end straight,
 * where a head or a mark sits and turns with the line. */
export function route(
  points: Point[],
  r = bendRadius,
  keep: [number, number] = [0, 0],
): string {
  const p = points;
  // An edge the engine left without a section has no points.
  if (p.length === 0) return "";
  const at = (q: Point) => `${f(q.x)},${f(q.y)}`;
  let d = `M${at(p[0])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const room1 = i === 1 ? l1 - keep[0] : l1 / 2;
    const room2 = i === p.length - 2 ? l2 - keep[1] : l2 / 2;
    const rr = Math.min(r, room1, room2);
    // Under half the radius a corner stays sharp: beside the others a
    // 2px arc read as a mistake, not a bend.
    if (rr < r / 2 || l1 === 0 || l2 === 0) {
      d += ` L${at(b)}`;
      continue;
    }
    const p1 = {
      x: b.x - ((b.x - a.x) / l1) * rr,
      y: b.y - ((b.y - a.y) / l1) * rr,
    };
    const p2 = {
      x: b.x + ((c.x - b.x) / l2) * rr,
      y: b.y + ((c.y - b.y) / l2) * rr,
    };
    d += ` L${at(p1)} Q${at(b)} ${at(p2)}`;
  }
  return d + ` L${at(p[p.length - 1])}`;
}

/** shorten pulls an end of a polyline back along its last segment. */
export function shorten(
  points: Point[],
  atStart: boolean,
  by: number,
): Point[] {
  const p = points.map((q) => ({ ...q }));
  if (p.length < 2) return p;
  const [a, b] = atStart ? [p[0], p[1]] : [p[p.length - 1], p[p.length - 2]];
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  if (len <= by) return p;
  a.x -= ((a.x - b.x) / len) * by;
  a.y -= ((a.y - b.y) / len) * by;
  return p;
}

/** drawFlow writes a flowchart layout. ids prefixes the marker id: two
 * drawings on one page must not share one. */
export function drawFlow(l: FlowLayout, pal: Palette, ids: string): string {
  // One head per arrow colour: a marker takes its fill from its own
  // definition, not from the line it ends.
  const defs =
    marker(ids, "arrow", filledHead, { fill: pal.muted }) +
    marker(ids, "warn", filledHead, { fill: pal.warn });
  return svg(l.width, l.height, pal, defs, [
    ...l.zones.map((z) => zone(z, pal)),
    ...l.edges.map((e) => edge(e, pal, ids)),
    ...l.edges.map((e) =>
      e.label ? label(e.label, e.warn ? pal.warn : pal.muted, pal) : "",
    ),
    ...l.nodes.map((n) => node(n, pal)),
  ]);
}

const filledHead = "M0,0 L10,5 L0,10 z";

/** marker is an arrowhead definition, its tip at refX on the line's end. */
function marker(
  ids: string,
  id: string,
  d: string,
  paint: Attrs,
  refX = 9,
): string {
  return el(
    "marker",
    {
      id: `${ids}-${id}`,
      viewBox: "0 0 10 10",
      refX,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto-start-reverse",
    },
    el("path", { d, ...paint }),
  );
}

/** svg is a drawing's root: its own size, its marker definitions, and the
 * canvas under everything drawn on it. extra goes on the root as well. */
function svg(
  width: number,
  height: number,
  pal: Palette,
  defs: string,
  body: string[],
  extra: Attrs = {},
): string {
  // No line round the drawing: a frame round the whole competed with the
  // boxes inside it, a swimlane's own frame drew a second one.
  const canvas = el("rect", {
    width,
    height,
    rx: 8,
    fill: pal.surface,
  });
  return el(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      "font-family": pal.sans,
      ...extra,
    },
    el("defs", {}, defs) + canvas + body.join(""),
  );
}

/** drawMindmap writes a mindmap: curves in the line colour, the topic and
 * the branches as pills in the tint, leaves as bare text, a leaf's own
 * children in the muted colour a step down. The focus keeps the flow's
 * meaning: an accent frame on a pill, an accent curve and text on a leaf,
 * and a pill's fill turns a faint accent, the tint of the accent rather
 * than of the ground (no role of its own: a consumer defines every role,
 * so the accent at low opacity over the surface it is drawn on).
 *
 * Paint order: canvas, curves, nodes. No markers: a mindmap's curves have
 * no direction to show. */
export function drawMindmap(l: MindmapLayout, pal: Palette): string {
  return svg(l.width, l.height, pal, "", [
    ...l.links.map((k) => {
      const [a, b, c, d] = k.points;
      return el("path", {
        d: `M${f(a.x)},${f(a.y)} C${f(b.x)},${f(b.y)} ${f(c.x)},${f(c.y)} ${f(d.x)},${f(d.y)}`,
        fill: "none",
        stroke: k.focus ? pal.accent : pal.line,
        "stroke-width": k.level === 1 ? (k.focus ? 1.7 : 1.4) : 1,
        "stroke-linecap": "round",
      });
    }),
    ...l.nodes.map((n) => mindNode(n, pal)),
  ]);
}

function mindNode(n: MindBox, pal: Palette): string {
  const pill = n.level < 2;
  // The topic is framed in the line colour as a flow's box is; a branch
  // is the tint alone, so the topic stays the heaviest thing drawn.
  const frame = n.focus ? pal.accent : n.level === 0 ? pal.line : undefined;
  const shape = pill
    ? el("rect", {
        x: f(n.x),
        y: f(n.y),
        width: f(n.w),
        height: f(n.h),
        rx: f(Math.min(n.h / 2, 20)),
        fill: n.focus ? pal.accent : pal.tint,
        "fill-opacity": n.focus ? 0.12 : undefined,
        stroke: frame,
        "stroke-width":
          frame === undefined ? undefined : n.level === 0 ? 1.2 : 1.4,
      })
    : "";
  // A pill's text is centred; a leaf's reads away from the topic, from
  // the end of its box facing it.
  const anchor = pill ? "middle" : n.side === -1 ? "end" : "start";
  const x = pill ? n.x + n.w / 2 : n.side === -1 ? n.x + n.w : n.x;
  const first = n.y + n.h / 2 - ((n.lines.length - 1) * ramp.lineHeight) / 2;
  // A marked pill says so with its frame; a leaf has none, so its text
  // takes the accent.
  const fill =
    n.focus && !pill ? pal.accent : n.level === 3 ? pal.muted : pal.fg;
  return (
    shape +
    n.lines
      .map((line, i) =>
        el(
          "text",
          {
            x: f(x),
            y: f(first + i * ramp.lineHeight),
            fill,
            "font-family": n.face === "mono" ? pal.mono : undefined,
            "font-size": n.size,
            "font-weight": n.bold ? 600 : undefined,
            "text-anchor": anchor,
            "dominant-baseline": "central",
          },
          esc(line),
        ),
      )
      .join("")
  );
}

/** drawSequence writes a sequence layout in the same vocabulary: boxes
 * framed in the line colour, lifelines a fine dash of it, messages in the
 * muted colour, a reply dashed, a frame a tinted box titled in the small
 * mono. No accent and no amber: the source has no focus to give, and a
 * dashed line here is a reply, not a boundary.
 *
 * Paint order: canvas, frames, lifelines, participants, notes, arrows, then
 * every text on a patch of its own ground, so a lifeline a message crosses
 * never strikes through its words. */
export function drawSequence(
  l: SequenceLayout,
  pal: Palette,
  ids: string,
): string {
  const line = { fill: "none", stroke: pal.muted, "stroke-width": 1.6 };
  const defs =
    marker(ids, "arrow", filledHead, { fill: pal.muted }) +
    marker(ids, "open", "M1,1 L9,5 L1,9", line) +
    marker(ids, "cross", "M2,2 L8,8 M8,2 L2,8", line, 5);
  return svg(l.width, l.height, pal, defs, [
    ...l.frames.map((fr) => frame(fr, pal)),
    ...l.lifelines.map((ln) =>
      el("line", {
        x1: f(ln.x),
        y1: f(ln.y1),
        x2: f(ln.x),
        y2: f(ln.y2),
        stroke: pal.line,
        "stroke-width": 1,
        "stroke-dasharray": "4 4",
      }),
    ),
    ...l.actors.map((a) => actor(a, pal)),
    ...l.notes.map((n) => note(n, pal)),
    ...l.messages.map((m) => message(m, pal, ids)),
    ...l.frames.map((fr) => frameText(fr, pal)),
    ...l.messages.map((m) =>
      m.label
        ? block(
            m.label,
            m.framed ? pal.tint : pal.surface,
            m.self,
            pal.muted,
            pal,
          )
        : "",
    ),
  ]);
}

/** drawER writes an entity model: tables framed as boxes are, their name
 * in a tinted head, fields in the mono with types and keys in the muted;
 * relationships in the muted line, a non-identifying one dashed (never
 * coloured: here a dash is a kind of relationship, not a boundary), each
 * end marked with its cardinality, crow's foot for many, bar for one,
 * ring for zero.
 *
 * Paint order: canvas, lines, marks, roles, tables. The marks are drawn,
 * not markers, so no id is needed. */
export function drawER(l: ERLayout, pal: Palette): string {
  return svg(l.width, l.height, pal, "", [
    ...l.edges.map((e, i) =>
      el("path", {
        d: route(e.points, bendRadius, [
          markRun[l.cards[i].from],
          markRun[l.cards[i].to],
        ]),
        fill: "none",
        stroke: pal.muted,
        "stroke-width": 1.4,
        "stroke-dasharray": e.dashed ? "5 4" : undefined,
      }),
    ),
    ...l.edges.map((e, i) =>
      e.points.length < 2
        ? ""
        : mark(e.points[0], e.points[1], l.cards[i].from, pal) +
          mark(
            e.points[e.points.length - 1],
            e.points[e.points.length - 2],
            l.cards[i].to,
            pal,
          ),
    ),
    ...l.edges.map((e) => (e.label ? label(e.label, pal.muted, pal) : "")),
    ...l.nodes.map((n) => entity(n, l.tables.get(n.id)!, pal)),
  ]);
}

/** mark is a cardinality at the end of a line that meets a table at end,
 * the line running on towards next: bars for exactly one, a ring for zero,
 * a crow's foot spread against the table for many. */
function mark(end: Point, next: Point, card: Card, pal: Palette): string {
  const len = Math.hypot(next.x - end.x, next.y - end.y) || 1;
  const u = { x: (next.x - end.x) / len, y: (next.y - end.y) / len };
  const v = { x: -u.y, y: u.x };
  const at = (s: number, t = 0) => ({
    x: end.x + u.x * s + v.x * t,
    y: end.y + u.y * s + v.y * t,
  });
  const stroke = { stroke: pal.muted, "stroke-width": 1.4, fill: "none" };
  const seg = (a: Point, b: Point) =>
    el("line", { x1: f(a.x), y1: f(a.y), x2: f(b.x), y2: f(b.y), ...stroke });
  const bar = (s: number) => seg(at(s, -6), at(s, 6));
  const ring = (s: number) => {
    const c = at(s);
    return el("circle", {
      cx: f(c.x),
      cy: f(c.y),
      r: 4,
      fill: pal.surface,
      stroke: pal.muted,
      "stroke-width": 1.2,
    });
  };
  const foot = () => seg(at(12), at(0, -7)) + seg(at(12), at(0, 7));
  switch (card) {
    case "one":
      return bar(8) + bar(13);
    case "zeroOrOne":
      return bar(8) + ring(17);
    case "oneOrMore":
      return foot() + bar(16);
    case "zeroOrMore":
      return foot() + ring(18);
  }
}

/** entity is a table: the frame of a box, a head in the tint under a
 * hairline, and a row per field, the columns as the layout lined them up. */
function entity(n: NodeBox, t: Table, pal: Palette): string {
  const stroke = n.focus ? pal.accent : pal.line;
  const width = n.focus ? 2 : 1.2;
  const r = 6;
  const head =
    t.rows.length === 0
      ? ""
      : el("path", {
          d: `M${f(n.x)},${f(n.y + t.head)} V${f(n.y + r)} Q${f(n.x)},${f(n.y)} ${f(n.x + r)},${f(n.y)} H${f(n.x + n.w - r)} Q${f(n.x + n.w)},${f(n.y)} ${f(n.x + n.w)},${f(n.y + r)} V${f(n.y + t.head)} Z`,
          fill: pal.tint,
        }) +
        el("line", {
          x1: f(n.x),
          y1: f(n.y + t.head),
          x2: f(n.x + n.w),
          y2: f(n.y + t.head),
          stroke: pal.line,
          "stroke-width": 1,
        });
  const first =
    n.y + t.head / 2 - ((t.name.lines.length - 1) * ramp.lineHeight) / 2;
  const name = t.name.lines
    .map((line, i) =>
      el(
        "text",
        {
          x: f(n.x + tablePad),
          y: f(first + i * ramp.lineHeight),
          fill: pal.fg,
          "font-family": t.name.face === "mono" ? pal.mono : undefined,
          "font-size": t.name.size,
          "font-weight": t.name.bold ? 600 : undefined,
          "dominant-baseline": "central",
        },
        esc(line),
      ),
    )
    .join("");
  const rows = t.rows
    .map((row) =>
      row.cells
        .map((c) =>
          c.text
            .map((line, i) =>
              el(
                "text",
                {
                  x: f(n.x + c.x),
                  y: f(n.y + row.y + rowPad / 2 + i * rowLine + rowLine / 2),
                  fill: c.muted ? pal.muted : pal.fg,
                  "font-family": c.face === "mono" ? pal.mono : undefined,
                  "font-size": c.size,
                  "dominant-baseline": "central",
                },
                esc(line),
              ),
            )
            .join(""),
        )
        .join(""),
    )
    .join("");
  // The frame last, over the head's fill, so its corners stay crisp.
  const box = el("rect", {
    x: n.x,
    y: n.y,
    width: n.w,
    height: n.h,
    rx: r,
    fill: "none",
    stroke,
    "stroke-width": width,
  });
  const ground = el("rect", {
    x: n.x,
    y: n.y,
    width: n.w,
    height: n.h,
    rx: r,
    fill: pal.surface,
  });
  return ground + head + name + rows + box;
}

/** drawClass writes a class diagram in the entity model's vocabulary:
 * classes framed as tables are, the name on the tint, fields and methods in
 * the mono under hairlines; relationships in the muted line, a realization
 * or a dependency dashed (a kind of relationship, never a boundary), each
 * marked at one end by what it is, multiplicities beside the ends.
 *
 * Paint order: canvas, lines, marks, texts, classes. The marks are drawn,
 * not markers, so no id is needed. */
export function drawClass(l: ClassLayout, pal: Palette): string {
  return svg(l.width, l.height, pal, "", [
    ...l.edges.map((e, i) => {
      // A line stops where its mark begins: run into a hollow triangle or
      // diamond, it showed through.
      const { from, to } = l.ends[i];
      let pts = e.points;
      if (pts.length < 2) return "";
      if (from.mark) pts = shorten(pts, true, markLength[from.mark]);
      if (to.mark) pts = shorten(pts, false, markLength[to.mark]);
      // The marks sit past the shortened ends, on the line's own heading.
      return el("path", {
        d: route(pts),
        fill: "none",
        stroke: pal.muted,
        "stroke-width": 1.4,
        "stroke-dasharray": e.dashed ? "5 4" : undefined,
      });
    }),
    ...l.edges.map((e, i) => {
      const p = e.points;
      const n = p.length;
      if (n < 2) return "";
      return (
        relMark(p[0], p[1], l.ends[i].from.mark, pal) +
        relMark(p[n - 1], p[n - 2], l.ends[i].to.mark, pal)
      );
    }),
    ...l.edges.map((e) => (e.label ? label(e.label, pal.muted, pal) : "")),
    ...l.ends.flatMap((end) =>
      [end.from.card, end.to.card].map((c) =>
        c ? label(c, pal.muted, pal) : "",
      ),
    ),
    ...l.nodes.map((n) => classBox(n, l.classes.get(n.id)!, pal)),
  ]);
}

/** relMark is what a relationship carries where it meets a class at end,
 * its line running on towards next: a hollow triangle at a parent, a
 * diamond at a whole (filled where the parts die with it), an arrowhead at
 * the class used. */
function relMark(
  end: Point,
  next: Point,
  m: Mark | null,
  pal: Palette,
): string {
  if (m === null) return "";
  const len = Math.hypot(next.x - end.x, next.y - end.y) || 1;
  const u = { x: (next.x - end.x) / len, y: (next.y - end.y) / len };
  const at = (s: number, t = 0) =>
    `${f(end.x + u.x * s - u.y * t)},${f(end.y + u.y * s + u.x * t)}`;
  const d = markLength[m];
  const hollow = {
    fill: pal.surface,
    stroke: pal.muted,
    "stroke-width": 1.2,
    "stroke-linejoin": "round",
  };
  switch (m) {
    case "triangle":
      return el("polygon", {
        points: `${at(0)} ${at(d, 7)} ${at(d, -7)}`,
        ...hollow,
      });
    case "diamond":
    case "filledDiamond":
      return el("polygon", {
        points: `${at(0)} ${at(d / 2, 5.5)} ${at(d)} ${at(d / 2, -5.5)}`,
        ...hollow,
        fill: m === "filledDiamond" ? pal.muted : pal.surface,
      });
    case "arrow":
      return el("polygon", {
        points: `${at(0.5)} ${at(d, 4.5)} ${at(d, -4.5)}`,
        fill: pal.muted,
      });
  }
}

/** classBox is a class: the frame of a box, the name (and stereotype) on
 * a tinted head, then fields and methods under hairlines, each compartment
 * as tall as the layout made it. The focus takes the accent on its frame
 * and hairlines both. */
function classBox(n: NodeBox, c: ClassBox, pal: Palette): string {
  const stroke = n.focus ? pal.accent : pal.line;
  const r = 6;
  const ground = el("rect", {
    x: n.x,
    y: n.y,
    width: n.w,
    height: n.h,
    rx: r,
    fill: pal.surface,
  });
  const head = el("path", {
    d: `M${f(n.x)},${f(n.y + c.head)} V${f(n.y + r)} Q${f(n.x)},${f(n.y)} ${f(n.x + r)},${f(n.y)} H${f(n.x + n.w - r)} Q${f(n.x + n.w)},${f(n.y)} ${f(n.x + n.w)},${f(n.y + r)} V${f(n.y + c.head)} Z`,
    fill: pal.tint,
  });
  const rule = (y: number) =>
    el("line", {
      x1: f(n.x),
      y1: f(y),
      x2: f(n.x + n.w),
      y2: f(y),
      stroke,
      "stroke-width": 1,
    });
  const cx = f(n.x + n.w / 2);
  let y = n.y + headPad;
  let texts = "";
  if (c.stereotype) {
    texts += el(
      "text",
      {
        x: cx,
        y: f(y + stereoLine / 2),
        fill: pal.muted,
        "font-size": ramp.label,
        "text-anchor": "middle",
        "dominant-baseline": "central",
      },
      esc(c.stereotype),
    );
    y += stereoLine;
  }
  for (const line of c.name) {
    texts += el(
      "text",
      {
        x: cx,
        y: f(y + ramp.lineHeight / 2),
        fill: pal.fg,
        "font-size": ramp.bold,
        "font-weight": 600,
        "text-anchor": "middle",
        "dominant-baseline": "central",
      },
      esc(line),
    );
    y += ramp.lineHeight;
  }
  const members = (ms: MemberLines[], top: number) => {
    let at = top + compPad;
    return ms
      .flatMap((m) =>
        m.lines.map((line) => {
          const t = el(
            "text",
            {
              x: f(n.x + tablePad),
              y: f(at + memberLine / 2),
              fill: pal.fg,
              "font-family": pal.mono,
              "font-size": ramp.label,
              "dominant-baseline": "central",
              "text-decoration": m.static ? "underline" : undefined,
              "font-style": m.abstract ? "italic" : undefined,
            },
            esc(line),
          );
          at += memberLine;
          return t;
        }),
      )
      .join("");
  };
  const fieldsTop = n.y + c.head;
  const methodsTop = fieldsTop + c.fieldsH;
  const box = el("rect", {
    x: n.x,
    y: n.y,
    width: n.w,
    height: n.h,
    rx: r,
    fill: "none",
    stroke,
    "stroke-width": n.focus ? 2 : 1.2,
  });
  return (
    ground +
    head +
    rule(fieldsTop) +
    rule(methodsTop) +
    texts +
    members(c.fields, fieldsTop) +
    members(c.methods, methodsTop) +
    box
  );
}

/** drawSwimlane writes a swimlane: one rounded frame in the line colour,
 * hairline dividers between the lanes and after the header column, each
 * lane's name as a muted eyebrow in capitals, and over that the flow in
 * the flowchart's own vocabulary (drawFlow).
 *
 * Paint order: canvas, frame and lanes, arrows, labels, steps. */
export function drawSwimlane(
  l: SwimlaneLayout,
  pal: Palette,
  ids: string,
): string {
  const defs =
    marker(ids, "arrow", filledHead, { fill: pal.muted }) +
    marker(ids, "warn", filledHead, { fill: pal.warn });
  const first = l.lanes[0];
  const last = l.lanes[l.lanes.length - 1];
  const top = first.y;
  const bottom = last.y + last.h;
  const hair = (x1: number, y1: number, x2: number, y2: number) =>
    el("line", { x1, y1, x2, y2, stroke: pal.line, "stroke-width": 1 });
  const lanes =
    el("rect", {
      x: first.x,
      y: top,
      width: first.w,
      height: bottom - top,
      rx: 6,
      fill: "none",
      stroke: pal.line,
      "stroke-width": 1,
    }) +
    l.lanes
      .slice(1)
      .map((ln) => hair(ln.x, ln.y, ln.x + ln.w, ln.y))
      .join("") +
    hair(first.x + l.head, top, first.x + l.head, bottom) +
    l.lanes
      .map((ln) => {
        const y0 = ln.y + ln.h / 2 - ((ln.lines.length - 1) * 16) / 2;
        return ln.lines
          .map((line, i) =>
            el(
              "text",
              {
                x: ln.x + titlePad,
                y: f(y0 + i * 16),
                fill: pal.muted,
                "font-size": ramp.label,
                "font-weight": 600,
                "letter-spacing": "0.08em",
                "dominant-baseline": "central",
              },
              esc(line),
            ),
          )
          .join("");
      })
      .join("");
  return svg(l.width, l.height, pal, defs, [
    lanes,
    ...l.edges.map((e) => edge(e, pal, ids)),
    ...l.edges.map((e) =>
      e.label ? label(e.label, e.warn ? pal.warn : pal.muted, pal) : "",
    ),
    ...l.nodes.map((n) => node(n, pal)),
  ]);
}

function frame(fr: SeqFrame, pal: Palette): string {
  return (
    el("rect", {
      x: f(fr.x),
      y: f(fr.y),
      width: f(fr.w),
      height: f(fr.h),
      rx: 10,
      fill: pal.tint,
      stroke: pal.line,
      "stroke-width": 1.2,
    }) +
    fr.dividers
      .map((d) =>
        el("line", {
          x1: f(fr.x),
          y1: f(d.y),
          x2: f(fr.x + fr.w),
          y2: f(d.y),
          stroke: pal.line,
          "stroke-width": 1,
          "stroke-dasharray": "4 4",
        }),
      )
      .join("")
  );
}

/** frameText is a frame's title and its dividers' conditions, each on a
 * patch of the frame's tint: a lifeline runs through the title's corner. */
function frameText(fr: SeqFrame, pal: Palette): string {
  const t = fr.title;
  const mono = {
    "font-family": pal.mono,
    "font-size": ramp.label,
    "dominant-baseline": "central",
  };
  const lh = t.h / Math.max(1, fr.cond.length);
  // The condition's lines all start where its first did, beside the
  // keyword, so a wrapped one reads as one block.
  const condX = t.x + textWidth(fr.keyword, ramp.label, "mono") + keywordGap;
  const title =
    knockout(t, pal.tint) +
    el(
      "text",
      {
        ...mono,
        x: f(t.x),
        y: f(t.y + lh / 2),
        fill: pal.fg,
        "font-weight": 600,
      },
      esc(fr.keyword),
    ) +
    fr.cond
      .map((line, i) =>
        el(
          "text",
          {
            ...mono,
            x: f(condX),
            y: f(t.y + i * lh + lh / 2),
            fill: pal.muted,
          },
          esc(line),
        ),
      )
      .join("");
  const conds = fr.dividers
    .map((d) => (d.label ? block(d.label, pal.tint, true, pal.muted, pal) : ""))
    .join("");
  return title + conds;
}

function knockout(
  r: { x: number; y: number; w: number; h: number },
  fill: string,
): string {
  return el("rect", {
    x: f(r.x - 3),
    y: f(r.y - 1),
    width: f(r.w + 6),
    height: f(r.h + 2),
    fill,
  });
}

function actor(a: SeqActor, pal: Palette): string {
  const first = a.y + a.h / 2 - ((a.lines.length - 1) * ramp.lineHeight) / 2;
  return (
    el("rect", {
      x: f(a.x),
      y: f(a.y),
      width: f(a.w),
      height: f(a.h),
      rx: 6,
      fill: pal.surface,
      stroke: pal.line,
      "stroke-width": 1.2,
    }) +
    a.lines
      .map((line, i) =>
        el(
          "text",
          {
            x: f(a.x + a.w / 2),
            y: f(first + i * ramp.lineHeight),
            fill: pal.fg,
            "font-family": a.face === "mono" ? pal.mono : undefined,
            "font-size": a.size,
            "font-weight": a.bold ? 600 : undefined,
            "text-anchor": "middle",
            "dominant-baseline": "central",
          },
          esc(line),
        ),
      )
      .join("")
  );
}

/** note is an aside, not a participant: a tinted patch with a rule on its
 * left and its text in the muted. Framed, it read as one more box. */
function note(n: SeqNote, pal: Palette): string {
  const first = n.y + n.h / 2 - ((n.lines.length - 1) * ramp.lineHeight) / 2;
  // Square on the left, where the rule runs the full height; a rounded
  // corner there left the rule's ends standing past the patch.
  const r = 4;
  const [x0, y0, x1, y1] = [n.x, n.y, n.x + n.w, n.y + n.h];
  return (
    el("path", {
      d: `M${f(x0)},${f(y0)} H${f(x1 - r)} Q${f(x1)},${f(y0)} ${f(x1)},${f(y0 + r)} V${f(y1 - r)} Q${f(x1)},${f(y1)} ${f(x1 - r)},${f(y1)} H${f(x0)} Z`,
      fill: pal.tint,
    }) +
    el("line", {
      x1: f(n.x + 1),
      y1: f(n.y),
      x2: f(n.x + 1),
      y2: f(n.y + n.h),
      stroke: pal.muted,
      "stroke-width": 2,
    }) +
    n.lines
      .map((line, i) =>
        el(
          "text",
          {
            x: f(n.x + notePad),
            y: f(first + i * ramp.lineHeight),
            fill: pal.muted,
            "font-size": ramp.text,
            "dominant-baseline": "central",
          },
          esc(line),
        ),
      )
      .join("")
  );
}

function message(m: SeqMessage, pal: Palette, ids: string): string {
  // A message ends on a lifeline, a hairline, not a box frame: the tip
  // touches it. Only the filled and open heads reach past their line's
  // end; a cross is centred on it.
  let pts = m.points;
  if (m.head === "filled" || m.head === "open" || m.head === "both")
    pts = shorten(pts, false, tipGap);
  if (m.head === "both") pts = shorten(pts, true, tipGap);
  const end =
    m.head === "open" ? "open" : m.head === "cross" ? "cross" : "arrow";
  // A self message's loop bends tighter than a flow's arrow: it is 20px
  // tall.
  return el("path", {
    d: route(pts, selfBend, [
      m.head === "both" ? headRun : 0,
      m.head === "none" ? 0 : headRun,
    ]),
    fill: "none",
    stroke: pal.muted,
    "stroke-width": 1.4,
    "stroke-dasharray": m.dashed ? "5 4" : undefined,
    "marker-end": m.head === "none" ? undefined : `url(#${ids}-${end})`,
    "marker-start": m.head === "both" ? `url(#${ids}-arrow)` : undefined,
  });
}

/** block is a text on a patch of its ground: centred over its arrow, or
 * read from the left beside a loop or under a divider. */
function block(
  t: TextBlock,
  ground: string,
  start: boolean,
  fill: string,
  pal: Palette,
): string {
  const lh = t.h / t.lines.length;
  return (
    knockout(t, ground) +
    t.lines
      .map((line, i) =>
        el(
          "text",
          {
            x: f(start ? t.x : t.x + t.w / 2),
            y: f(t.y + i * lh + lh / 2),
            fill,
            "font-family": t.face === "mono" ? pal.mono : undefined,
            "font-size": t.size,
            "letter-spacing": t.track ? `${t.track}em` : undefined,
            "text-anchor": start ? "start" : "middle",
            "dominant-baseline": "central",
          },
          esc(line),
        ),
      )
      .join("")
  );
}

function zone(z: ZoneBox, pal: Palette): string {
  return (
    el("rect", {
      x: z.x,
      y: z.y,
      width: z.w,
      height: z.h,
      rx: 10,
      fill: pal.tint,
      stroke: pal.line,
      "stroke-width": 1.2,
    }) +
    el(
      "text",
      {
        x: z.x + 18,
        y: z.y + 26,
        fill: pal.fg,
        "font-size": ramp.bold,
        "font-weight": 600,
      },
      esc(z.title),
    )
  );
}

function edge(e: EdgeRoute, pal: Palette, ids: string): string {
  let pts = e.points;
  if (e.head !== "none") pts = shorten(pts, false, headGap);
  if (e.head === "both") pts = shorten(pts, true, headGap);
  const marker = `url(#${ids}-${e.warn ? "warn" : "arrow"})`;
  return el("path", {
    d: route(pts, bendRadius, [
      e.head === "both" ? headRun : 0,
      e.head === "none" ? 0 : headRun,
    ]),
    fill: "none",
    stroke: e.warn ? pal.warn : pal.muted,
    "stroke-width": 1.4,
    "stroke-dasharray": e.dashed ? "5 4" : undefined,
    "marker-end": e.head === "none" ? undefined : marker,
    "marker-start": e.head === "both" ? marker : undefined,
  });
}

function label(m: LabelBox, fill: string, pal: Palette): string {
  const attrs = {
    fill,
    "font-family": pal.mono,
    "font-size": m.size ?? ramp.label,
    "letter-spacing": m.track ? `${m.track}em` : undefined,
  };
  if (m.vertical) {
    const cx = m.x + m.w / 2;
    const cy = m.y + m.h / 2;
    return el(
      "text",
      {
        ...attrs,
        x: f(cx),
        y: f(cy),
        "text-anchor": "middle",
        "dominant-baseline": "central",
        transform: `rotate(-90 ${f(cx)} ${f(cy)})`,
      },
      esc(m.lines[0]),
    );
  }
  const lh = m.h / m.lines.length;
  return m.lines
    .map((line, i) =>
      el(
        "text",
        {
          ...attrs,
          x: f(m.x + m.w / 2),
          y: f(m.y + i * lh + lh / 2),
          "text-anchor": "middle",
          "dominant-baseline": "central",
        },
        esc(line),
      ),
    )
    .join("");
}

function node(n: NodeBox, pal: Palette): string {
  // A state diagram's `[*]`: where it begins a dot in the text colour,
  // where it ends the same dot in a ring. No text and no focus to carry.
  if (n.kind === "start" || n.kind === "stop") {
    const cx = f(n.x + n.w / 2);
    const cy = f(n.y + n.h / 2);
    const r = n.w / 2;
    if (n.kind === "start") return el("circle", { cx, cy, r, fill: pal.fg });
    return (
      el("circle", {
        cx,
        cy,
        r: r - 0.7,
        fill: pal.surface,
        stroke: pal.fg,
        "stroke-width": 1.4,
      }) + el("circle", { cx, cy, r: r - 5, fill: pal.fg })
    );
  }
  // The focus is framed in the accent at twice the weight, the reference's way
  // of marking the steps the page is about.
  const stroke = n.focus ? pal.accent : pal.line;
  let shape: string;
  if (n.kind === "decision") {
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    shape = el("polygon", {
      points: `${f(cx)},${f(n.y)} ${f(n.x + n.w)},${f(cy)} ${f(cx)},${f(n.y + n.h)} ${f(n.x)},${f(cy)}`,
      fill: pal.surface,
      stroke,
      "stroke-width": n.focus ? 2 : 1.2,
    });
  } else {
    const outcome = n.kind === "outcome";
    shape = el("rect", {
      x: n.x,
      y: n.y,
      width: n.w,
      height: n.h,
      rx: 6,
      fill: outcome ? pal.tint : pal.surface,
      stroke,
      "stroke-width": n.focus ? 2 : outcome ? 1 : 1.2,
    });
  }
  // An outcome reads from its left edge, as the reference's do; every other box
  // is centred on its own axis.
  const start = n.kind === "outcome";
  const x = start ? n.x + 16 : n.x + n.w / 2;
  const first = n.y + n.h / 2 - ((n.lines.length - 1) * ramp.lineHeight) / 2;
  const text = n.lines
    .map((line, i) =>
      el(
        "text",
        {
          x: f(x),
          y: f(first + i * ramp.lineHeight),
          fill: pal.fg,
          "font-family": n.face === "mono" ? pal.mono : undefined,
          "font-size": n.size,
          "font-weight": n.bold ? 600 : undefined,
          "text-anchor": start ? "start" : "middle",
          "dominant-baseline": "central",
        },
        esc(line),
      ),
    )
    .join("");
  return shape + text;
}

// ---- timeline and quadrant: drawings without boxes ----

/** drawTimeline writes a timeline: the line and its drops as hairlines in
 * the line colour, a dot per period in the text colour, the periods and
 * section names muted, what happened in the text colour. No accent: the
 * source has no focus to give.
 *
 * The root carries which way it lies and the width it lies flat at
 * (data-orient, data-wide): a card shown at another width reads them and
 * asks for the other drawing only when its room crosses that width. */
export function drawTimeline(l: TimelineLayout, pal: Palette): string {
  return svg(
    l.width,
    l.height,
    pal,
    "",
    [
      hairline(l.line, pal.line, 1.2),
      ...l.rules.map((s) => hairline(s, pal.line, 1)),
      ...l.drops.map((s) => hairline(s, pal.line, 1)),
      ...l.dots.map((d) =>
        el("circle", { cx: f(d.x), cy: f(d.y), r: d.r, fill: pal.fg }),
      ),
      ...l.texts.map((t) => plotText(t, pal)),
    ],
    { "data-orient": l.orient, "data-wide": l.wide },
  );
}

/** drawQuadrant writes a 2×2: the plot's frame a hairline, the axis cross
 * in the muted colour with a head at each high end, no filled quadrants,
 * every point a dot in the text colour, the focus a larger one in the
 * accent with its label bold in it. ids prefixes the marker id. */
export function drawQuadrant(
  l: QuadrantLayout,
  pal: Palette,
  ids: string,
): string {
  const p = l.plot;
  return svg(
    l.width,
    l.height,
    pal,
    marker(ids, "axis", filledHead, { fill: pal.muted }),
    [
      el("rect", {
        x: p.x,
        y: p.y,
        width: p.size,
        height: p.size,
        fill: "none",
        stroke: pal.line,
        "stroke-width": 1,
      }),
      ...l.axes.map((s) =>
        el("line", {
          x1: f(s.x1),
          y1: f(s.y1),
          x2: f(s.x2),
          y2: f(s.y2),
          stroke: pal.muted,
          "stroke-width": 1,
          "marker-end": `url(#${ids}-axis)`,
        }),
      ),
      // Lighter than an axis: a pointer, not a line of the chart.
      ...l.leaders.map((s) => hairline(s, pal.muted, 0.75)),
      ...l.dots.map((d) =>
        el("circle", {
          cx: f(d.x),
          cy: f(d.y),
          r: d.r,
          fill: d.focus ? pal.accent : pal.fg,
        }),
      ),
      ...l.texts.map((t) => plotText(t, pal)),
    ],
  );
}

function hairline(s: Segment, stroke: string, width: number): string {
  return el("line", {
    x1: f(s.x1),
    y1: f(s.y1),
    x2: f(s.x2),
    y2: f(s.y2),
    stroke,
    "stroke-width": width,
  });
}

/** plotText is a free text, its lines set from its box's anchor. */
function plotText(t: PlotText, pal: Palette): string {
  const fill =
    t.role === "accent" ? pal.accent : t.role === "muted" ? pal.muted : pal.fg;
  const x =
    t.anchor === "start" ? t.x : t.anchor === "end" ? t.x + t.w : t.x + t.w / 2;
  return t.lines
    .map((line, i) =>
      el(
        "text",
        {
          x: f(x),
          y: f(t.y + i * t.lineH + t.lineH / 2),
          fill,
          "font-size": t.size,
          "font-weight": t.bold ? 600 : undefined,
          "letter-spacing": t.track > 0 ? `${t.track}em` : undefined,
          "text-anchor": t.anchor,
          "dominant-baseline": "central",
        },
        esc(line),
      ),
    )
    .join("");
}
