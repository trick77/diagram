import type { FlowIR, SwimlaneIR } from "./ir";
import {
  isMapping,
  boxWidth,
  frame,
  labelBox,
  onDiamond,
  shaped,
  type EdgeRoute,
  type FlowLayout,
  type LabelBox,
  type NodeBox,
  type Point,
} from "./layout";
import { ramp, textWidth, wrap } from "./theme";

/**
 * Where a swimlane goes: one band per role, top to bottom in the order
 * written, inside one rounded frame; the role's name as an eyebrow in a
 * header column on the left; every step a flowchart box in its own band;
 * the flow left to right. A handoff is the upright stretch of a square
 * connector between two bands, a decision's branch into another band
 * leaves from its top or bottom corner, an arrow with a step in its way
 * runs over its band, and a loop back runs dashed under the steps or over
 * them, whichever crosses fewer arrows, never through a box.
 *
 * Laid out by hand, not by ELK. The engine's partitions order its layers,
 * which in a left-to-right flow are the columns: a partition per lane put
 * each role's steps in columns of their own, never in a band across. So a
 * step's column is its rank along the flow (the longest path to it, a
 * cycle broken at the edge written against the order, as the flow's
 * layout breaks it), its band is its lane, and two steps in one band and
 * column stack inside the band. A shape the connectors here cannot route
 * square and clear (a loop back out of a step with another stacked under
 * it) is declined, and drawn as the flow it was written as.
 */

export type LaneBox = {
  id: string;
  title: string;
  /** The eyebrow: the name in capitals, a line per entry. */
  lines: string[];
  /** The steps in this lane. */
  nodes: string[];
  x: number;
  y: number;
  w: number;
  h: number;
};
export type SwimlaneLayout = FlowLayout & {
  lanes: LaneBox[];
  /** The header column's width, at each lane's left. */
  head: number;
};

/** A lane's room above and below its steps; between two steps stacked in
 * one column. */
const lanePad = 24;
const cellGap = 20;
/** The least gap between two columns, and the margin before the first and
 * after the last. */
const gapMin = 48;
const gapEdge = 32;
/** An upright stretch's first track in a gap, and the distance between
 * two tracks. */
const trackIn = 16;
const track = 12;
/** Clear space between a label and its line. */
const labelGap = 8;
/** Attach points on one side of a box: bare, and where an arrow entering
 * carries a label above it, which the next arrow up must clear. */
const portGap = 12;
const portRoom = 32;
/** Attach points along a box's bottom, where loop backs leave and enter. */
const footGap = 16;

/** The eyebrow: the small sans at 600 in capitals, spaced out. */
export const titlePad = 14;
const titleMax = 132;
const tracking = 0.08;
const titleLine = 16;

/** eyebrowWidth is the width a lane's name takes in capitals, its letter
 * spacing included: the width budget (theme.ts) already counts capitals
 * wider than lowercase. */
export function eyebrowWidth(s: string): number {
  return (
    textWidth(s, ramp.label, "sans") + [...s].length * tracking * ramp.label
  );
}

/** eyebrows is each lane's name in capitals, wrapped, and the header
 * column wide enough for the widest; an untitled lane has no line. */
export function eyebrows(names: string[]): {
  titles: string[][];
  head: number;
} {
  const titles = names.map((t) =>
    t === ""
      ? []
      : wrap(t.toUpperCase(), titleMax / (1 + tracking), ramp.label, "sans"),
  );
  const widest = Math.max(0, ...titles.flatMap((ls) => ls.map(eyebrowWidth)));
  return { titles, head: Math.ceil(widest / 4) * 4 + 2 * titlePad };
}

/** asFlow is a swimlane as the flowchart it was written as, its lanes as
 * zones. */
export function asFlow(ir: SwimlaneIR): FlowIR {
  return {
    kind: "flow",
    direction: ir.direction ?? "LR",
    nodes: ir.nodes.map(({ lane, ...n }) => ({ ...n, zone: lane })),
    edges: ir.edges,
    zones: ir.lanes,
  };
}

/** asSwimlane is a flow with every step in a zone as a swimlane, its
 * direction kept, or null for one with a step outside every zone. */
export function asSwimlane(ir: FlowIR): SwimlaneIR | null {
  const zones = new Set(ir.zones.map((z) => z.id));
  if (ir.nodes.some((n) => n.zone === undefined || !zones.has(n.zone)))
    return null;
  return {
    kind: "swimlane",
    ...(ir.direction === "TB" ? { direction: "TB" as const } : {}),
    lanes: ir.zones,
    nodes: ir.nodes.map(({ zone, ...n }) => ({ ...n, lane: zone! })),
    edges: ir.edges,
  };
}

/** laneFlow is a zoned flow as lanes take it, or null for one that is no
 * lanes: the one reading both a mermaid source (./mermaid) and a JSON IR
 * asked for lanes (lanesOf), so the two never disagree.
 *
 * Its zones are the roles holding steps, in the order written: a zone
 * written twice (a model reopening its subgraph) and zones of one title
 * (a role opened again for a step late in the flow) are one lane, where
 * the role was first written; a zone with no id holds no step. Two roles
 * at least, an arrow, none from a step to itself. A two-zone mapping
 * (isMapping) keeps its own layout. Top-down, an arrow must hand over
 * from one role to another: zones nothing hands between are flows side by
 * side, each in its frame. everyZoned asks every step to sit in a role (a
 * swimlane); bands put the rest in a last band. maxLanes caps the roles:
 * past it, a top-down source stays a flow, drawn with zones, rather than
 * lanes the caps hand to the renderer. */
export function laneFlow(
  f: FlowIR,
  opts: { everyZoned: boolean; maxLanes?: number },
): FlowIR | null {
  if (
    f.edges.length === 0 ||
    isMapping(f) ||
    f.edges.some((e) => e.from === e.to)
  )
    return null;
  const { roles, laneOf } = rolesOf(f);
  if (roles.length < 2) return null;
  if (opts.maxLanes !== undefined && roles.length > opts.maxLanes) return null;
  // A step in a zone no role holds (undeclared, or "") is in none.
  const nodes: FlowIR["nodes"] = f.nodes.map(({ zone, ...n }) => {
    const lane = zone === undefined ? undefined : laneOf.get(zone);
    return lane === undefined ? n : { ...n, zone: lane };
  });
  if (opts.everyZoned && nodes.some((n) => n.zone === undefined)) return null;
  const zoneOf = new Map(nodes.map((n) => [n.id, n.zone ?? ""]));
  if (
    f.direction === "TB" &&
    !f.edges.some((e) => zoneOf.get(e.from) !== zoneOf.get(e.to))
  )
    return null;
  return { ...f, zones: roles, nodes };
}

/** rolesOf is a flow's roles as laneFlow reads them, and the role each
 * declared zone holding a step belongs to. */
function rolesOf(f: FlowIR): {
  roles: FlowIR["zones"];
  laneOf: Map<string, string>;
} {
  const holds = new Set(f.nodes.map((n) => n.zone));
  const first = new Map<string, string>();
  const laneOf = new Map<string, string>();
  const roles: FlowIR["zones"] = [];
  for (const z of f.zones) {
    if (z.id === "" || laneOf.has(z.id) || !holds.has(z.id)) continue;
    const role = z.title !== "" ? z.title : z.id;
    if (!first.has(role)) {
      first.set(role, z.id);
      roles.push(z);
    }
    laneOf.set(z.id, first.get(role)!);
  }
  return { roles, laneOf };
}

/** laneOrder is a band order by zone id as laneFlow merges the zones: a
 * zone merged into another's lane stands for that lane, where first asked
 * for; a zone no role holds for the steps of none, "". */
export function laneOrder(f: FlowIR, order: string[]): string[] {
  const { laneOf } = rolesOf(f);
  const out: string[] = [];
  for (const id of order) {
    const lane = laneOf.get(id) ?? "";
    if (!out.includes(lane)) out.push(lane);
  }
  return out;
}

type Side = "left" | "right" | "top" | "bottom";

/** layoutSwimlane lays a swimlane out, or returns null for a shape it
 * cannot route. Its loop backs run under the steps, or over them where
 * that crosses fewer arrows: under the lane, a loop out of an upper lane
 * cut the branch a decision sent down past it. A top-down swimlane is
 * declined: its bands are the engine's (layoutBands, layoutSwimlaneChecked),
 * and laid out here it came out on its side. */
export function layoutSwimlane(ir: SwimlaneIR): SwimlaneLayout | null {
  if (ir.direction === "TB") return null;
  const under = lay(ir, false);
  if (under === null || !ir.edges.length) return under;
  const over = lay(ir, true);
  if (over === null) return under;
  return crossings(over) < crossings(under) ? over : under;
}

/** crossings counts the places where two arrows cross. */
function crossings(l: FlowLayout): number {
  const segs = l.edges.map((e) =>
    e.points.slice(1).map((p, k) => [e.points[k], p] as const),
  );
  const cut = (a: Point, b: Point, c: Point, d: Point) => {
    if ((a.y === b.y) === (c.y === d.y)) return false;
    const [h, v] =
      a.y === b.y
        ? [
            [a, b],
            [c, d],
          ]
        : [
            [c, d],
            [a, b],
          ];
    const inside = (p: number, q: number, r: number) =>
      p > Math.min(q, r) && p < Math.max(q, r);
    return inside(v[0].x, h[0].x, h[1].x) && inside(h[0].y, v[0].y, v[1].y);
  };
  let n = 0;
  segs.forEach((s, i) => {
    for (const t of segs.slice(i + 1))
      for (const [a, b] of s) for (const [c, d] of t) if (cut(a, b, c, d)) n++;
  });
  return n;
}

function lay(ir: SwimlaneIR, loopsOver: boolean): SwimlaneLayout | null {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const laneIdx = new Map(ir.lanes.map((l, i) => [l.id, i]));
  if (ir.nodes.some((n) => !laneIdx.has(n.lane))) return null;
  if (
    ir.edges.some(
      (e) => !byId.has(e.from) || !byId.has(e.to) || e.from === e.to,
    )
  )
    return null;
  const laneOf = (id: string) => laneIdx.get(byId.get(id)!.lane)!;
  const E = ir.edges;

  // Steps in the order the arrows first name them: lanes group the steps
  // as written, so only the arrows say which comes first.
  const mention = new Map<string, number>();
  for (const e of E)
    for (const id of [e.from, e.to])
      if (!mention.has(id)) mention.set(id, mention.size);
  for (const n of ir.nodes)
    if (!mention.has(n.id)) mention.set(n.id, mention.size);
  const order = ir.nodes
    .map((n) => n.id)
    .sort((a, b) => mention.get(a)! - mention.get(b)!);
  const outs = new Map(order.map((id) => [id, [] as number[]]));
  E.forEach((e, i) => outs.get(e.from)!.push(i));

  // A loop back is an arrow into a step still on the way to it, walked
  // from the starts, every arrow in the order written.
  const back = new Set<number>();
  const state = new Map<string, "open" | "done">();
  const walk = (id: string) => {
    state.set(id, "open");
    for (const i of outs.get(id)!) {
      const s = state.get(E[i].to);
      if (s === "open") back.add(i);
      else if (s === undefined) walk(E[i].to);
    }
    state.set(id, "done");
  };
  const targets = new Set(E.map((e) => e.to));
  for (const id of [...order.filter((id) => !targets.has(id)), ...order])
    if (!state.has(id)) walk(id);
  const fwd = (i: number) => !back.has(i);

  // Columns: the longest way to a step along the flow. A step nothing
  // leads to sits just before the first step it leads to, not at the far
  // left with a long arrow across.
  const topo: string[] = [];
  const seen = new Set<string>();
  const post = (id: string) => {
    seen.add(id);
    for (const i of outs.get(id)!)
      if (fwd(i) && !seen.has(E[i].to)) post(E[i].to);
    topo.push(id);
  };
  for (const id of order) if (!seen.has(id)) post(id);
  topo.reverse();
  const col = new Map(order.map((id) => [id, 0]));
  for (const id of topo)
    for (const i of outs.get(id)!)
      if (fwd(i))
        col.set(E[i].to, Math.max(col.get(E[i].to)!, col.get(id)! + 1));
  for (const id of [...topo].reverse()) {
    if (E.some((e, i) => fwd(i) && e.to === id)) continue;
    const on = outs.get(id)!.filter(fwd);
    if (on.length > 0)
      col.set(id, Math.min(...on.map((i) => col.get(E[i].to)!)) - 1);
  }
  const ncol = Math.max(...col.values()) + 1;

  // Cells: the steps of one lane in one column, stacked.
  const key = (l: number, c: number) => `${l}:${c}`;
  const cells = new Map<string, string[]>();
  for (const id of order) {
    const k = key(laneOf(id), col.get(id)!);
    cells.set(k, [...(cells.get(k) ?? []), id]);
  }
  const cellOf = (id: string) => cells.get(key(laneOf(id), col.get(id)!))!;
  const rowOf = (id: string) => cellOf(id).indexOf(id);
  const lowest = (id: string) => rowOf(id) === cellOf(id).length - 1;
  const empty = (l: number, c: number) => !cells.has(key(l, c));
  const between = (a: number, b: number) =>
    Array.from(
      { length: Math.max(0, Math.abs(b - a) - 1) },
      (_, k) => Math.min(a, b) + 1 + k,
    );

  const w = boxWidth(
    ir.nodes.filter((n) => n.shape !== "decision"),
    112,
    168,
  );
  const boxes = new Map<string, NodeBox>();
  for (const n of ir.nodes)
    boxes.set(n.id, shaped(n, n.shape === "pill" ? "pill" : "step", w));
  const labels = E.map((e) => (e.label !== "" ? labelBox(e.label) : null));

  // Where each arrow leaves and enters. Along the flow: out of the right
  // side, into the left. A loop back: out of the bottom and up into the
  // bottom. A decision's branch into another lane: out of its top or
  // bottom corner, straight up or down to the step's height, when nothing
  // stands in the way.
  const exit = new Map<number, Side>();
  const entry = new Map<number, Side>();
  E.forEach((_, i) => {
    exit.set(i, fwd(i) ? "right" : "bottom");
    entry.set(i, fwd(i) ? "left" : "bottom");
  });
  // A loop back run over the steps instead, when asked: out of the top of
  // the step it leaves and into the top of the one it returns to, along
  // the band above the upper of their lanes, the way up from both clear.
  const aloft = new Set<number>();
  if (loopsOver)
    for (const i of back) {
      const { from, to } = E[i];
      const t = Math.min(laneOf(from), laneOf(to));
      const clearUp = (id: string) =>
        rowOf(id) === 0 &&
        between(t - 1, laneOf(id)).every((l) => empty(l, col.get(id)!));
      if (!clearUp(from) || !clearUp(to)) continue;
      aloft.add(i);
      exit.set(i, "top");
      entry.set(i, "top");
    }
  const cornerClear = (a: string, b: string) => {
    const la = laneOf(a);
    const lb = laneOf(b);
    const c = col.get(a)!;
    const k = rowOf(a);
    if (lb > la ? !lowest(a) : k !== 0) return false;
    if (!between(la, lb).every((l) => empty(l, c))) return false;
    if (!empty(lb, c)) return false;
    return between(c, col.get(b)!).every((cc) => empty(lb, cc));
  };
  for (const n of ir.nodes) {
    if (boxes.get(n.id)!.kind !== "decision") continue;
    let down = false;
    let up = false;
    for (const i of outs.get(n.id)!) {
      if (!fwd(i)) continue;
      const lb = laneOf(E[i].to);
      const la = laneOf(n.id);
      if (lb > la && !down && cornerClear(n.id, E[i].to)) {
        exit.set(i, "bottom");
        down = true;
      } else if (lb < la && !up && cornerClear(n.id, E[i].to)) {
        exit.set(i, "top");
        up = true;
      }
    }
  }

  // Attach points: the ends on one side of a box spread apart, ordered so
  // arrows leave towards where they go without crossing at the box. The
  // first one along its own lane sits level with the box's middle, so an
  // arrow along a lane runs straight.
  type End = { i: number; at: "from" | "to"; sort: number[]; level: boolean };
  const sides = new Map<string, End[]>();
  const add = (id: string, side: Side, end: End) => {
    const k = `${id}:${side}`;
    sides.set(k, [...(sides.get(k) ?? []), end]);
  };
  // An arrow along its lane past a step in between likely runs over the
  // lane's top: it leaves and enters above the others.
  const skips = (i: number) =>
    fwd(i) &&
    laneOf(E[i].from) === laneOf(E[i].to) &&
    between(col.get(E[i].from)!, col.get(E[i].to)!).some(
      (c) => !empty(laneOf(E[i].from), c),
    );
  const at = (id: string, i: number) => [
    laneOf(id) - (skips(i) ? 0.5 : 0),
    rowOf(id),
    col.get(id)!,
  ];
  E.forEach((e, i) => {
    const span = col.get(e.from)! - col.get(e.to)!;
    const level = fwd(i) && laneOf(e.to) === laneOf(e.from) && !skips(i);
    add(e.from, exit.get(i)!, {
      i,
      at: "from",
      // Out of a bottom, a loop spanning further leaves further right, so
      // it passes outside the shorter one's way down.
      sort: fwd(i) ? at(e.to, i) : [span],
      level,
    });
    add(e.to, entry.get(i)!, {
      i,
      at: "to",
      sort: fwd(i) ? at(e.from, i) : [-span],
      level,
    });
  });
  const off = new Map<string, number>();
  for (const [k, ends] of sides) {
    const [id, side] = k.split(":") as [string, Side];
    const b = boxes.get(id)!;
    ends.sort((p, q) => {
      for (let j = 0; j < Math.min(p.sort.length, q.sort.length); j++)
        if (p.sort[j] !== q.sort[j]) return p.sort[j] - q.sort[j];
      return p.i - q.i;
    });
    const upright = side === "left" || side === "right";
    const labelled = side === "left" && ends.some((x) => labels[x.i] !== null);
    let gap = upright ? (labelled ? portRoom : portGap) : footGap;
    const lead = upright ? ends.findIndex((x) => x.level) : -1;
    const anchor = lead >= 0 ? lead : (ends.length - 1) / 2;
    const reach = Math.max(anchor, ends.length - 1 - anchor);
    // A diamond keeps its size: its points close up instead.
    if (b.kind === "decision" && reach > 0)
      gap = Math.min(gap, ((upright ? b.h : b.w) / 2 - 8) / reach);
    else if (upright)
      b.h = Math.max(b.h, Math.ceil((2 * reach * gap + 24) / 4) * 4);
    ends.forEach((x, j) =>
      off.set(`${x.i}:${x.at}`, Math.round((j - anchor) * gap)),
    );
  }
  const offOf = (i: number, at: "from" | "to") => off.get(`${i}:${at}`)!;

  // Loop backs run under the steps, out of the bottom of the one they
  // leave and up into the bottom of the one they return to, each on a
  // track of a lane's corridor: the shortest nearest the steps, so they
  // nest. Under the lower of the two lanes when the way down from both is
  // clear of every other step, as one stretch; else under each step's own
  // lane, joined by an upright in the gap after the target's column.
  // Along the corridor a column c is at 2c and the gap after it at 2c + 1.
  type Run = {
    i: number;
    lane: number;
    lo: number;
    hi: number;
    k: number;
    /** The stretch that carries the loop's label. */
    labelled: boolean;
  };
  const runs: Run[] = [];
  const riser = new Set<number>();
  for (const i of back) {
    if (aloft.has(i)) continue;
    const { from, to } = E[i];
    if (!lowest(from) || !lowest(to)) return null;
    const ca = col.get(from)!;
    const cb = col.get(to)!;
    const m = Math.max(laneOf(from), laneOf(to));
    const clearDown = (id: string) =>
      between(laneOf(id), m + 1).every((l) => empty(l, col.get(id)!));
    if (clearDown(from) && clearDown(to)) {
      runs.push({ i, lane: m, lo: 2 * cb, hi: 2 * ca, k: 0, labelled: true });
      continue;
    }
    riser.add(i);
    runs.push(
      {
        i,
        lane: laneOf(from),
        lo: 2 * cb + 1,
        hi: 2 * ca,
        k: 0,
        labelled: true,
      },
      {
        i,
        lane: laneOf(to),
        lo: 2 * cb,
        hi: 2 * cb + 1,
        k: 0,
        labelled: false,
      },
    );
  }
  const runOf = (i: number, lane: number) =>
    runs.find((r) => r.i === i && r.lane === lane)!;
  const tracks = ir.lanes.map(() => [] as Run[][]);
  for (const r of [...runs].sort(
    (p, q) => p.hi - p.lo - (q.hi - q.lo) || p.i - q.i,
  )) {
    const t = tracks[r.lane];
    let k = t.findIndex((rs) => rs.every((s) => r.hi < s.lo || r.lo > s.hi));
    if (k < 0) {
      k = t.length;
      t.push([]);
    }
    t[k].push(r);
    r.k = k;
  }

  // Down the page: each lane as tall as its tallest stack, its corridor
  // and its name, with room above for the labels over arrows entering its
  // top steps.
  const { titles, head } = eyebrows(ir.lanes.map((l) => l.title));
  const cy = new Map<string, number>();
  const laneY: number[] = [];
  const laneH: number[] = [];
  const corridor: number[][] = [];
  // overhead[l] is the height of the band over lane l's steps, where
  // arrows run over them.
  const place = (overhead: number[]) => {
    laneY.length = 0;
    laneH.length = 0;
    corridor.length = 0;
    let y = 0;
    ir.lanes.forEach((_, l) => {
      const stacks = [...cells.entries()]
        .filter(([k]) => k.startsWith(`${l}:`))
        .map(([, ids]) => ids);
      const stackH = (ids: string[]) =>
        ids.reduce((s, id) => s + boxes.get(id)!.h, 0) +
        (ids.length - 1) * cellGap;
      const area = Math.max(0, ...stacks.map(stackH));
      // Centres relative to the area's top.
      const rel = new Map<string, number>();
      for (const ids of stacks) {
        let at = (area - stackH(ids)) / 2;
        for (const id of ids) {
          rel.set(id, at + boxes.get(id)!.h / 2);
          at += boxes.get(id)!.h + cellGap;
        }
      }
      // A label sits above the arrow entering a step's left side.
      let top = lanePad;
      E.forEach((e, i) => {
        if (!fwd(i) || !labels[i] || laneOf(e.to) !== l) return;
        const above = rel.get(e.to)! + offOf(i, "to") - labelGap - labels[i]!.h;
        top = Math.max(top, 6 - above);
      });
      // Over the labels, a band for the arrows running over the steps.
      top += overhead[l];
      laneY.push(y);
      for (const [id, r] of rel) cy.set(id, y + top + r);
      // The corridor: a track per run, each with room above it for a label.
      let at = y + top + area;
      corridor.push(
        tracks[l].map((rs) => {
          const lh = Math.max(
            0,
            ...rs.map((r) => (r.labelled && labels[r.i] ? labels[r.i]!.h : 0)),
          );
          at += lh > 0 ? lh + labelGap + 6 : 14;
          return at;
        }),
      );
      const h = Math.max(
        at - y + lanePad,
        titles[l].length * titleLine + 2 * lanePad,
      );
      laneH.push(Math.ceil(h / 4) * 4);
      y += laneH[l];
    });
    for (const [id, c] of cy) {
      const b = boxes.get(id)!;
      b.y = Math.round(c - b.h / 2);
      cy.set(id, b.y + b.h / 2);
    }
  };
  place(ir.lanes.map(() => 0));

  // Along the flow: each arrow straight where it can, else turning once in
  // a gap. A turn takes the gap before its target when its own height is
  // clear on the way there, else the gap after its source when the
  // target's height is. With both blocked by steps in between, it runs
  // over the top of its source's lane: up in the gap after the source,
  // along a band above that lane's steps, down in the gap before the
  // target.
  const clearAt = (l: number, at: number, c0: number, c1: number) =>
    between(c0, c1).every((c) =>
      (cells.get(key(l, c)) ?? []).every((id) => {
        const b = boxes.get(id)!;
        // Closer than a track's width, an arrow read as part of the step.
        return at < b.y - track || at > b.y + b.h + track;
      }),
    );
  type Way = "straight" | "turn" | "corner" | "loop" | "over";
  const way: Way[] = [];
  const gapOf = new Map<number, number>();
  const ya = (i: number) => cy.get(E[i].from)! + offOf(i, "from");
  const yb = (i: number) => cy.get(E[i].to)! + offOf(i, "to");
  for (let i = 0; i < E.length; i++) {
    const { from, to } = E[i];
    const ca = col.get(from)!;
    const cb = col.get(to)!;
    if (!fwd(i)) {
      way.push("loop");
      continue;
    }
    if (exit.get(i) !== "right") {
      way.push("corner");
      continue;
    }
    const la = laneOf(from);
    const lb = laneOf(to);
    if (ya(i) === yb(i) && clearAt(la, ya(i), ca, cb)) {
      way.push("straight");
    } else if (clearAt(la, ya(i), ca, cb)) {
      way.push("turn");
      gapOf.set(i, cb - 1);
    } else if (clearAt(lb, yb(i), ca, cb)) {
      way.push("turn");
      gapOf.set(i, ca);
    } else {
      way.push("over");
    }
  }

  // The bands over the lanes: a track per arrow running over, the
  // shortest nearest the steps, a loop's with room above it for its
  // label. An arrow along the flow runs over its source's lane from the
  // gap after it to the gap before its target; a loop over the upper of
  // its lanes from column to column. Along the band a column c is at 2c
  // and the gap after it at 2c + 1.
  const overs = way.flatMap((w, i) => (w === "over" ? [i] : []));
  const band = (i: number) =>
    aloft.has(i)
      ? {
          lane: Math.min(laneOf(E[i].from), laneOf(E[i].to)),
          lo: 2 * col.get(E[i].to)!,
          hi: 2 * col.get(E[i].from)!,
        }
      : {
          lane: laneOf(E[i].from),
          lo: 2 * col.get(E[i].from)! + 1,
          hi: 2 * col.get(E[i].to)! - 1,
        };
  const overTrack = new Map<number, number>();
  const overUsed = ir.lanes.map(() => [] as number[][]);
  for (const i of [...overs, ...aloft].sort(
    (p, q) => band(p).hi - band(p).lo - (band(q).hi - band(q).lo) || p - q,
  )) {
    const { lane, lo, hi } = band(i);
    const t = overUsed[lane];
    let k = t.findIndex((js) =>
      js.every((j) => hi < band(j).lo || lo > band(j).hi),
    );
    if (k < 0) {
      k = t.length;
      t.push([]);
    }
    t[k].push(i);
    overTrack.set(i, k);
  }
  // Each track's room, and the line's height in its lane: the innermost
  // lowest, just over the labels on the arrows into the lane's steps.
  const room = overUsed.map((t) =>
    t.map((js) => {
      const lh = Math.max(
        0,
        ...js.map((j) => (aloft.has(j) && labels[j] ? labels[j]!.h : 0)),
      );
      return lh > 0 ? lh + labelGap + 6 : track;
    }),
  );
  const bandH = room.map((rs) =>
    rs.length > 0 ? rs.reduce((s, r) => s + r, 0) + 12 : 0,
  );
  if (bandH.some((h) => h > 0)) place(bandH);
  const overY = (i: number) => {
    const { lane } = band(i);
    const k = overTrack.get(i)!;
    return laneY[lane] + 4 + room[lane].slice(k).reduce((s, r) => s + r, 0);
  };

  // Tracks in each gap: an upright stretch gets the first track whose
  // stretches it does not meet. Going down, the one leaving lowest takes
  // the innermost track; going up, the one leaving highest: an arrow then
  // never crosses another out of the same box.
  const ty = (i: number, lane: number) => corridor[lane][runOf(i, lane).k];
  const uprights = [
    ...[...gapOf.entries()].map(([i, g]) => ({ i, g, a: ya(i), b: yb(i) })),
    ...[...riser].map((i) => ({
      i,
      g: col.get(E[i].to)!,
      a: ty(i, laneOf(E[i].from)),
      b: ty(i, laneOf(E[i].to)),
    })),
    ...overs.flatMap((i) => [
      { i, g: col.get(E[i].from)!, a: ya(i), b: overY(i) },
      { i, g: col.get(E[i].to)! - 1, a: overY(i), b: yb(i) },
    ]),
  ];
  // An arrow's track in a gap, by arrow and gap: one running over a lane
  // has an upright in two.
  const gapTracks = new Map<string, number>();
  const trackOf = (i: number, g: number) => gapTracks.get(`${i}:${g}`)!;
  const nTracks = new Map<number, number>();
  for (let g = 0; g < ncol; g++) {
    const segs = uprights
      .filter((s) => s.g === g)
      .sort((p, q) => {
        const pd = p.b > p.a ? 0 : 1;
        const qd = q.b > q.a ? 0 : 1;
        if (pd !== qd) return pd - qd;
        return pd === 0 ? q.a - p.a : p.a - q.a;
      });
    const used: { lo: number; hi: number }[][] = [];
    for (const s of segs) {
      const lo = Math.min(s.a, s.b);
      const hi = Math.max(s.a, s.b);
      let k = used.findIndex((t) =>
        t.every((u) => hi + track <= u.lo || lo >= u.hi + track),
      );
      if (k < 0) {
        k = used.length;
        used.push([]);
      }
      used[k].push({ lo, hi });
      gapTracks.set(`${s.i}:${g}`, k);
    }
    nTracks.set(g, used.length);
  }

  // Across the page: the header, then columns as wide as their widest
  // step, the gaps between wide enough for their tracks and for the labels
  // over the arrows entering the next column.
  const colW = Array.from({ length: ncol }, (_, c) =>
    Math.max(
      0,
      ...order.filter((id) => col.get(id) === c).map((id) => boxes.get(id)!.w),
    ),
  );
  const labelRoom = Array.from({ length: ncol }, (_, g) => {
    const lw = Math.max(
      0,
      ...E.map((e, i) =>
        fwd(i) && labels[i] && col.get(e.to) === g + 1 ? labels[i]!.w : 0,
      ),
    );
    return lw > 0 ? lw + labelGap + 12 : 0;
  });
  const gapW = Array.from({ length: ncol }, (_, g) => {
    const t = nTracks.get(g) ?? 0;
    const turns = t > 0 ? 2 * trackIn + (t - 1) * track : 0;
    if (g === ncol - 1) return Math.max(gapEdge, turns);
    return Math.max(gapMin, Math.ceil((turns + labelRoom[g]) / 8) * 8);
  });
  // The tracks of a gap sit in the middle of the room its labels leave:
  // hard against the step they leave, every turn read as part of it.
  const trackX = (g: number, k: number) => {
    const span = ((nTracks.get(g) ?? 1) - 1) * track;
    const room = gapW[g] - labelRoom[g];
    return (
      gapX[g] + Math.max(trackIn, Math.round((room - span) / 2)) + k * track
    );
  };
  const colX: number[] = [];
  const gapX: number[] = [];
  let x = head + gapEdge;
  for (let c = 0; c < ncol; c++) {
    colX.push(x);
    x += colW[c];
    gapX.push(x);
    x += gapW[c];
  }
  const width = x;
  for (const id of order) {
    const b = boxes.get(id)!;
    const c = col.get(id)!;
    b.x = Math.round(colX[c] + (colW[c] - b.w) / 2);
  }

  const routes: EdgeRoute[] = E.map((e, i) => {
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    const y0 = ya(i);
    const y1 = yb(i);
    let points: Point[];
    let label: LabelBox | undefined;
    const l = labels[i];
    if (way[i] === "loop" && aloft.has(i)) {
      const ax = Math.round(a.x + a.w / 2 + offOf(i, "from"));
      const bx = Math.round(b.x + b.w / 2 + offOf(i, "to"));
      const oy = overY(i);
      points = [
        { x: ax, y: a.y },
        { x: ax, y: oy },
        { x: bx, y: oy },
        { x: bx, y: b.y },
      ];
      if (l)
        label = {
          ...l,
          x: Math.round((ax + bx) / 2 - l.w / 2),
          y: oy - labelGap - l.h,
        };
    } else if (way[i] === "loop") {
      const ax = Math.round(a.x + a.w / 2 + offOf(i, "from"));
      const bx = Math.round(b.x + b.w / 2 + offOf(i, "to"));
      const t0 = ty(
        i,
        riser.has(i) ? laneOf(e.from) : Math.max(laneOf(e.from), laneOf(e.to)),
      );
      // Where the stretch carrying the label ends on the left: the target
      // under one corridor, the upright between two.
      let lx = bx;
      if (riser.has(i)) {
        lx = trackX(col.get(e.to)!, trackOf(i, col.get(e.to)!));
        const t1 = ty(i, laneOf(e.to));
        points = [
          { x: ax, y: a.y + a.h },
          { x: ax, y: t0 },
          { x: lx, y: t0 },
          { x: lx, y: t1 },
          { x: bx, y: t1 },
          { x: bx, y: b.y + b.h },
        ];
      } else {
        points = [
          { x: ax, y: a.y + a.h },
          { x: ax, y: t0 },
          { x: bx, y: t0 },
          { x: bx, y: b.y + b.h },
        ];
      }
      if (l)
        label = {
          ...l,
          x: Math.round((ax + lx) / 2 - l.w / 2),
          y: t0 - labelGap - l.h,
        };
    } else {
      const end = { x: b.x, y: y1 };
      if (way[i] === "corner") {
        const cx = Math.round(a.x + a.w / 2 + offOf(i, "from"));
        const top = exit.get(i) === "top";
        points = [{ x: cx, y: top ? a.y : a.y + a.h }, { x: cx, y: y1 }, end];
      } else if (way[i] === "straight") {
        points = [{ x: a.x + a.w, y: y0 }, end];
      } else if (way[i] === "over") {
        const g0 = col.get(e.from)!;
        const g1 = col.get(e.to)! - 1;
        const x0 = trackX(g0, trackOf(i, g0));
        const x1 = trackX(g1, trackOf(i, g1));
        const oy = overY(i);
        points = [
          { x: a.x + a.w, y: y0 },
          { x: x0, y: y0 },
          { x: x0, y: oy },
          { x: x1, y: oy },
          { x: x1, y: y1 },
          end,
        ];
      } else {
        const g = gapOf.get(i)!;
        const tx = trackX(g, trackOf(i, g));
        points = [
          { x: a.x + a.w, y: y0 },
          { x: tx, y: y0 },
          { x: tx, y: y1 },
          end,
        ];
      }
      if (l) label = { ...l, x: b.x - 12 - l.w, y: y1 - labelGap - l.h };
    }
    // Ends on a diamond move from its box onto its outline.
    const n = points.length;
    if (a.kind === "decision") points[0] = onDiamond(a, points[0], points[1]);
    if (b.kind === "decision")
      points[n - 1] = onDiamond(b, points[n - 1], points[n - 2]);
    const route: EdgeRoute = {
      from: e.from,
      to: e.to,
      points,
      // Back against the flow is a loop, drawn dashed as every layout
      // draws its retry; the warn colour stays the source's dotted arrow.
      dashed: e.dashed || way[i] === "loop",
      warn: e.dashed,
      head: e.head,
    };
    if (label) route.label = label;
    return route;
  });

  const lanes: LaneBox[] = ir.lanes.map((ln, l) => ({
    id: ln.id,
    title: ln.title,
    lines: titles[l],
    nodes: order.filter((id) => laneOf(id) === l),
    x: 0,
    y: laneY[l],
    w: width,
    h: laneH[l],
  }));
  const nodes = ir.nodes.map((n) => boxes.get(n.id)!);
  return { ...frame(nodes, routes, [], lanes), lanes, head };
}
