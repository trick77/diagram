import type { ElkNode } from "elkjs/lib/elk-api";
import type { FlowIR } from "./ir";
import {
  boxWidth,
  dotted,
  elkEdge,
  elkLabel,
  elkPoints,
  frame,
  labelBox,
  onCircle,
  onDiamond,
  px,
  shaped,
  type EdgeRoute,
  type Elk,
  type NodeBox,
  type Point,
} from "./layout";
import { eyebrows, type LaneBox, type SwimlaneLayout } from "./swimlane";
import { check, checkSwimlane } from "./check/check";

/**
 * Where a zoned top-down flow goes: its zones as bands stacked top to
 * bottom in the order written, each band's name as an eyebrow in a header
 * column on the left, the flow running down through them. A step sits in
 * its band, below every step of the band that leads to it; a handoff runs
 * down out of one band into the next, its turns in the gap between them; a
 * label sits beside its own arrow. Steps no zone holds make a last band
 * without a name.
 *
 * The system and repository maps (who calls, where it enters, the parts,
 * the stores, what is outside) are this shape, as is a process drawn
 * top-down across roles.
 *
 * ELK's layered layout with a partition per row. Partitions order the
 * layers, which in a top-down flow are the rows: band after band down the
 * page, never side by side. Zones as compound nodes did not hold that:
 * they were placed beside each other and an arrow between two ran through
 * a third. A left-to-right flow's lanes run across its layers, which
 * partitions cannot hold; that swimlane is laid out by hand (swimlane.ts).
 *
 * A row wider than a page column is wrapped: its steps go to two or more
 * rows of their band, every other one down, so each still spans the band
 * and an arrow into the lower one passes between the upper one's steps.
 * Unwrapped, the 22-box system map was 2004px wide by 837, drawn at half
 * size in its card; wrapped, 1541 by 1283; with its boxes pulled to the
 * shortest arrows and tighter gaps 1102 by 1160, and at a flow's gaps and
 * bold names 1222 by 1256. Partitions are integers, so a row is simply one
 * more; the engine's own bounds (a Coffman-Graham layer bound, a layer
 * chosen per step) did not narrow it: the width was the arrows passing
 * through. It stays wider than a page column (almanach's own layout drew
 * it 888px wide by 1527, breaking the connector rules 63 times). Boxes placed where asked
 * and the arrows routed round them (the engine's interactive placement)
 * bundled the arrows into long parallel runs: not used.
 */

/** A band's room above its first steps and below its last. */
const bandPad = 20;
/** The least clear space between a divider and a stretch of line or a
 * label running along it. */
const dividerClear = 8;
/** Between the header column and the first step, and after the last. */
const headGap = 24;
/** The widest a banded drawing is laid out before its rows wrap: almanach's
 * page column (1400px less its padding, the rail and the gap). Wider, the
 * card shrinks it and its text with it. */
export const bandWidth = 1080;
/** Across a row, between two boxes, and the boxes' widths: a flow's
 * (layoutElk). Tighter (24, boxes from 128px) the map was 1102px wide
 * rather than 1222, but read crowded beside every other drawing. */
const nodeGap = 40;
const boxMin = 160;
const boxMax = 248;

/** A band: its zone (empty for the steps of none), its title, its steps as
 * written. */
export type Band = { id: string; title: string; nodes: string[] };

/** bandsOf is a flow's zones holding steps, top to bottom, and the steps in
 * no zone as a last band without a name. The zones order names come
 * first, in that order, the rest after them as written: almanach's maps
 * name theirs by role (who calls, where it enters, the parts, the stores,
 * what is outside), whatever order a model wrote them in. */
export function bandsOf(ir: FlowIR, order: string[] = []): Band[] {
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  // A zone written twice (a model reopening its subgraph) is one band, its
  // first title; a zone with no id holds the steps of none. Read apart, a
  // band held no step and the dividers' search for its edge never ended.
  const seen = new Set<string>();
  const zones = ir.zones.filter((z) => {
    if (z.id === "" || seen.has(z.id)) return false;
    seen.add(z.id);
    return true;
  });
  const out: Band[] = zones
    .map((z, i) => ({ z, i }))
    .sort((a, b) => rank(a.z.id) - rank(b.z.id) || a.i - b.i)
    .map(({ z }) => ({
      id: z.id,
      title: z.title,
      nodes: ir.nodes.filter((n) => n.zone === z.id).map((n) => n.id),
    }))
    .filter((b) => b.nodes.length > 0);
  const known = new Set(out.map((b) => b.id));
  const loose = ir.nodes
    .filter((n) => n.zone === undefined || !known.has(n.zone))
    .map((n) => n.id);
  if (loose.length > 0) out.push({ id: "", title: "", nodes: loose });
  return out;
}

/** layoutBands lays a top-down flow out in bands, stacked as bandsOf
 * orders them, or returns null for one it does not draw so: an arrow from
 * a step to itself, or to or from a step it does not hold (the engine
 * throws on one). */
export async function layoutBands(
  ir: FlowIR,
  elk: Elk,
  order: string[] = [],
): Promise<SwimlaneLayout | null> {
  const held = new Set(ir.nodes.map((n) => n.id));
  if (
    ir.nodes.length === 0 ||
    ir.edges.some(
      (e) => e.from === e.to || !held.has(e.from) || !held.has(e.to),
    )
  )
    return null;
  const bands = bandsOf(ir, order);
  const bandIdx = new Map(bands.map((b, i) => [b.id, i]));
  const bandOf = (zone: string | undefined) =>
    bandIdx.get(zone !== undefined && bandIdx.has(zone) ? zone : "")!;
  const band = new Map(ir.nodes.map((n) => [n.id, bandOf(n.zone)]));
  const w = boxWidth(
    ir.nodes.filter((n) => n.shape !== "decision"),
    boxMin,
    boxMax,
  );
  const { head } = eyebrows(bands.map((b) => b.title));

  // A step's row is its band's first unless the engine stacks it lower:
  // laid out once with a partition per band, the rows are read back.
  const crossings = (l: SwimlaneLayout) =>
    check(l).filter((s) => s.endsWith(": cross")).length;
  // Each placement is laid out in the order written and free of it, two
  // ways across: centred on its neighbours (Brandes-Koepf) and pulled to
  // the shortest arrows (network simplex). The one breaking the fewest
  // rules wins, then the one crossing the fewest arrows, then the one with
  // the least empty room before a band's first box, then the narrowest:
  // centred, a band of two boxes sat over the arrows they lead to, the
  // 22-box map's top bands 600px in from their names; pulled short, about
  // half that, and the map a fifth narrower.
  // The widest empty room any band has before its first box.
  const lead = (l: SwimlaneLayout) => {
    const content = Math.min(...l.nodes.map((n) => n.x));
    return Math.max(
      ...l.lanes.map(
        (ln) =>
          Math.min(
            ...ln.nodes.map((id) => l.nodes.find((n) => n.id === id)!.x),
          ) - content,
      ),
    );
  };
  const best = async (part: Map<string, number>) => {
    let out: SwimlaneLayout | null = null;
    let key: number[] = [];
    for (const placement of ["BRANDES_KOEPF", "NETWORK_SIMPLEX"] as const)
      for (const free of [false, true]) {
        const l = await place(ir, elk, bands, band, part, w, free, placement);
        const k = [checkSwimlane(l).length, crossings(l), lead(l), l.width];
        const better = k.findIndex((v, j) => v !== key[j]);
        if (out === null || (better >= 0 && k[better] < key[better])) {
          out = l;
          key = k;
        }
      }
    return out!;
  };
  const first = await best(band);
  // A row is the steps whose boxes overlap in height (a diamond is taller
  // than a step beside it), left to right.
  const rows = bands.map((_, i) => {
    const out: { bottom: number; boxes: NodeBox[] }[] = [];
    for (const n of first.nodes
      .filter((n) => band.get(n.id) === i)
      .sort((a, b) => a.y - b.y)) {
      const row = out[out.length - 1];
      if (row && n.y < row.bottom) {
        row.boxes.push(n);
        row.bottom = Math.max(row.bottom, n.y + n.h);
      } else out.push({ bottom: n.y + n.h, boxes: [n] });
    }
    return out.map((r) => r.boxes.sort((a, b) => a.x - b.x).map((b) => b.id));
  });
  const widest = Math.max(...rows.flat().map((r) => r.length));
  const fit = Math.max(
    2,
    Math.floor((bandWidth - head - 2 * headGap + nodeGap) / (w + nodeGap)),
  );
  if (first.width <= bandWidth || widest <= 2) return first;
  let out = first;
  let outRules = checkSwimlane(first).length;
  const tried = new Set<string>();
  for (let k = Math.min(fit, widest - 1); k >= 2; k--) {
    const part = new Map<string, number>();
    let p = 0;
    for (const bandRows of rows)
      for (const row of bandRows) {
        // Every other step down, so each row still spans the band.
        const r = Math.ceil(row.length / k);
        row.forEach((id, j) => part.set(id, p + (j % r)));
        p += r;
      }
    // Two widths can split every row alike (eight boxes: two rows at five
    // to a row and at four); laid out once.
    const split = [...part.values()].join(",");
    if (tried.has(split)) continue;
    tried.add(split);
    const l = await best(part);
    const rules = checkSwimlane(l).length;
    if (
      keeps({ rules: outRules, width: out.width }, { rules, width: l.width })
    ) {
      out = l;
      outRules = rules;
    }
    if (out.width <= bandWidth && outRules === 0) break;
  }
  return out;
}

/** keeps says a wrapped layout replaces the one kept so far: it breaks
 * fewer rules, or as many and is narrower. By width alone a wrap that
 * broke a rule replaced the clean layout before it. */
export function keeps(
  out: { rules: number; width: number },
  l: { rules: number; width: number },
): boolean {
  return l.rules < out.rules || (l.rules === out.rules && l.width < out.width);
}

/** loopBacks is the arrow closing each cycle, the one drawn dashed. The
 * solid arrows are walked first, from the starts in the order the arrows
 * name them, every arrow in the order written: one into a step still on
 * the way to it closes a cycle, as the swimlane reads it. A dotted arrow
 * then closes a cycle if the step it points at already leads to the one it
 * leaves. Asked of every arrow at once, a map's consumer calling its
 * service was dashed for the loop its own event closed through the event
 * log. */
export function loopBacks(ir: FlowIR): Set<number> {
  const outs = new Map(ir.nodes.map((n) => [n.id, [] as number[]]));
  ir.edges.forEach((e, i) => {
    if (!e.dashed) outs.get(e.from)?.push(i);
  });
  const mention: string[] = [];
  for (const e of ir.edges)
    for (const id of [e.from, e.to])
      if (outs.has(id) && !mention.includes(id)) mention.push(id);
  for (const n of ir.nodes) if (!mention.includes(n.id)) mention.push(n.id);
  const targets = new Set(ir.edges.filter((e) => !e.dashed).map((e) => e.to));
  const back = new Set<number>();
  const state = new Map<string, "open" | "done">();
  const walk = (id: string) => {
    state.set(id, "open");
    for (const i of outs.get(id)!) {
      const to = ir.edges[i].to;
      const s = state.get(to);
      if (s === "open") back.add(i);
      else if (s === undefined && outs.has(to)) walk(to);
    }
    state.set(id, "done");
  };
  for (const id of [...mention.filter((id) => !targets.has(id)), ...mention])
    if (!state.has(id)) walk(id);
  for (const i of back)
    outs
      .get(ir.edges[i].from)!
      .splice(outs.get(ir.edges[i].from)!.indexOf(i), 1);
  const reaches = (from: string, to: string) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === to) return true;
      for (const i of outs.get(id) ?? []) {
        const next = ir.edges[i].to;
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  ir.edges.forEach((e, i) => {
    if (!e.dashed || !outs.has(e.from)) return;
    if (reaches(e.to, e.from)) back.add(i);
    else outs.get(e.from)!.push(i);
  });
  return back;
}

type Rect = { x: number; y: number; w: number; h: number };

/** gapTo is how far a rect lies from an upright or level stretch. */
function gapTo(r: Rect, a: Point, b: Point): number {
  const dx = Math.max(
    r.x - Math.max(a.x, b.x),
    Math.min(a.x, b.x) - (r.x + r.w),
    0,
  );
  const dy = Math.max(
    r.y - Math.max(a.y, b.y),
    Math.min(a.y, b.y) - (r.y + r.h),
    0,
  );
  return Math.hypot(dx, dy);
}

/** openGap opens by px of room across the drawing at height at: every box,
 * point and label from there down moves by it, an upright stretch across
 * it grows. A label goes with the stretch of its own arrow it sits beside:
 * down with one wholly below, where it stays with one wholly above, and
 * with one growing across the gap down only if it began below. Moved by
 * its own height, a label over a stretch just below the gap stayed above
 * it while the stretch went down: 24px from its line. */
export function openGap(
  nodes: NodeBox[],
  routes: EdgeRoute[],
  at: number,
  by: number,
): void {
  // Each label's stretch, read before anything moves.
  const beside = routes.map((r) => {
    if (!r.label || r.points.length < 2) return null;
    let k = 0;
    for (let j = 1; j + 1 < r.points.length; j++)
      if (
        gapTo(r.label, r.points[j], r.points[j + 1]) <
        gapTo(r.label, r.points[k], r.points[k + 1])
      )
        k = j;
    return [r.points[k].y >= at, r.points[k + 1].y >= at] as const;
  });
  for (const b of nodes) if (b.y >= at) b.y += by;
  routes.forEach((r, i) => {
    for (const p of r.points) if (p.y >= at) p.y += by;
    const l = r.label;
    if (!l) return;
    const s = beside[i];
    const down = s
      ? s[0] && s[1]
        ? true
        : s[0] || s[1]
          ? l.y >= at
          : false
      : l.y >= at;
    if (down) l.y += by;
  });
}

/** A label beside its line, as the flow's layouts set it. */
const labelGap = 8;
/** Clear space between a label and any other line. */
const labelClear = 3;

/** settle moves a label another arrow runs through, or that lies on a box
 * or another label, along its own arrow to the first spot clear of them:
 * beside an upright stretch or over a level one, nearest the arrow's start
 * first. The engine sets a label at its arrow's start but makes no room for
 * it there, and two arrows leaving one box ran through each other's. A
 * label with no clear spot stays where the engine put it, for the check to
 * report. */
function settle(routes: EdgeRoute[], nodes: NodeBox[]): void {
  const segs = (ps: Point[]) => ps.slice(1).map((p, k) => [ps[k], p] as const);
  const gap = (r: Rect, a: Point, b: Point) => {
    const dx = Math.max(
      r.x - Math.max(a.x, b.x),
      Math.min(a.x, b.x) - (r.x + r.w),
      0,
    );
    const dy = Math.max(
      r.y - Math.max(a.y, b.y),
      Math.min(a.y, b.y) - (r.y + r.h),
      0,
    );
    return Math.hypot(dx, dy);
  };
  const meets = (p: Rect, q: Rect, by = 0) =>
    p.x < q.x + q.w + by &&
    q.x < p.x + p.w + by &&
    p.y < q.y + q.h + by &&
    q.y < p.y + p.h + by;
  const placed: Rect[] = [];
  for (const r of routes) {
    const l = r.label;
    if (!l) continue;
    const others = routes.filter((o) => o !== r).flatMap((o) => segs(o.points));
    const own = segs(r.points);
    const ok = (c: Rect) =>
      others.every(([a, b]) => gap(c, a, b) >= labelClear) &&
      own.every(([a, b]) => gap(c, a, b) >= labelGap - 2) &&
      nodes.every((n) => !meets(c, n)) &&
      placed.every((p) => !meets(c, p, 2));
    if (!ok(l)) {
      const spots: Rect[] = [];
      for (const [a, b] of segs(r.points)) {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let t = 0; t <= len; t += 4) {
          if (a.x === b.x) {
            const dir = Math.sign(b.y - a.y);
            const y = dir > 0 ? a.y + t : a.y - t - l.h;
            if (
              Math.min(y, y + l.h) < Math.min(a.y, b.y) ||
              Math.max(y, y + l.h) > Math.max(a.y, b.y)
            )
              continue;
            spots.push({ ...l, x: a.x + labelGap, y });
            spots.push({ ...l, x: a.x - labelGap - l.w, y });
          } else {
            const dir = Math.sign(b.x - a.x);
            const x = dir > 0 ? a.x + t : a.x - t - l.w;
            if (x < Math.min(a.x, b.x) || x + l.w > Math.max(a.x, b.x))
              continue;
            spots.push({ ...l, x, y: a.y - labelGap - l.h });
            spots.push({ ...l, x, y: a.y + labelGap });
          }
        }
      }
      const spot = spots.find(ok);
      if (spot) {
        l.x = spot.x;
        l.y = spot.y;
      }
    }
    placed.push(l);
  }
}

/** place is one laid out drawing: the engine's layout with the given
 * partitions, free of the order written or not, its bands drawn round the
 * rows each holds. */
async function place(
  ir: FlowIR,
  elk: Elk,
  bands: { id: string; title: string }[],
  band: Map<string, number>,
  part: Map<string, number>,
  w: number,
  free: boolean,
  placement: "BRANDES_KOEPF" | "NETWORK_SIMPLEX" = "BRANDES_KOEPF",
): Promise<SwimlaneLayout> {
  const boxes = new Map<string, NodeBox>();
  for (const n of ir.nodes)
    boxes.set(n.id, shaped(n, n.shape === "pill" ? "pill" : "step", w));
  const back = loopBacks(ir);
  const labels = ir.edges.map((e) =>
    e.label !== "" ? labelBox(e.label) : null,
  );
  const root = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      "elk.partitioning.activate": "true",
      "elk.spacing.nodeNode": String(nodeGap),
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "12",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeLabel": "8",
      "elk.edgeLabels.placement": "CENTER",
      // Ranks in the order written, unless asked free: the order written
      // kept a process's steps where the source put them, and free of it
      // the 22-box map crossed 8 arrows rather than 13.
      "elk.layered.considerModelOrder.strategy": free
        ? "NONE"
        : "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
      "elk.layered.thoroughness": "50",
      "elk.layered.nodePlacement.strategy": placement,
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
    },
    children: ir.nodes.map((n): ElkNode => ({
      id: n.id,
      width: boxes.get(n.id)!.w,
      height: boxes.get(n.id)!.h,
      layoutOptions: {
        "elk.partitioning.partition": String(part.get(n.id)!),
      },
    })),
    edges: ir.edges.map((e, i) => {
      // A label at the arrow's start, beside its first stretch: there it
      // reads as the way out of its box and never strays from its line. In
      // the middle, the engine gave every label a layer of its own: the
      // 22-box map was 2004px wide even unwrapped, and its labels sat
      // between two layers, an arrow's length from either box.
      const le = elkEdge(`e${i}`, e.from, e.to, e.label, labels[i]);
      for (const l of le.labels ?? [])
        l.layoutOptions = { "elk.edgeLabels.placement": "TAIL" };
      return le;
    }),
  });
  for (const c of root.children ?? []) {
    const b = boxes.get(c.id)!;
    b.x = px(c.x ?? 0);
    b.y = px(c.y ?? 0);
  }
  const routes: EdgeRoute[] = (root.edges ?? []).map((le, i) => {
    const e = ir.edges[i];
    const points = elkPoints(le);
    const from = boxes.get(e.from)!;
    const to = boxes.get(e.to)!;
    if (points.length >= 2) {
      const n = points.length;
      if (from.kind === "decision")
        points[0] = onDiamond(from, points[0], points[1]);
      if (to.kind === "decision")
        points[n - 1] = onDiamond(to, points[n - 1], points[n - 2]);
      if (dotted(from.kind)) points[0] = onCircle(from, points[0], points[1]);
      if (dotted(to.kind))
        points[n - 1] = onCircle(to, points[n - 1], points[n - 2]);
    }
    const route: EdgeRoute = {
      from: e.from,
      to: e.to,
      points,
      // A loop back is the arrow closing a cycle, dashed as every layout
      // draws it; the warn colour stays the source's dotted arrow. Not
      // every arrow up: in a map a store feeding a service above it points
      // up without looping, and read by height the branch up to a step
      // was dashed instead of the arrow back from it.
      dashed: e.dashed || back.has(i),
      warn: e.dashed,
      head: e.head,
    };
    const label = elkLabel(le, labels[i]);
    if (label) route.label = label;
    return route;
  });
  const nodes = ir.nodes.map((n) => boxes.get(n.id)!);
  settle(routes, nodes);
  const members = bands.map((_, i) =>
    ir.nodes.filter((n) => band.get(n.id) === i).map((n) => n.id),
  );

  // Dividers: in the gap between two bands, where no stretch of line runs
  // along and no label sits. A gap without such a height is opened where
  // it comes closest, every upright stretch across it growing.
  const along = () => [
    ...routes.flatMap((r) =>
      r.points.slice(1).flatMap((p, k) => {
        const q = r.points[k];
        return q.y === p.y ? [{ y0: p.y, y1: p.y }] : [];
      }),
    ),
    ...routes.flatMap((r) =>
      r.label ? [{ y0: r.label.y, y1: r.label.y + r.label.h }] : [],
    ),
  ];
  const span = (i: number) => {
    const bs = members[i].map((id) => boxes.get(id)!);
    return {
      top: Math.min(...bs.map((b) => b.y)),
      bottom: Math.max(...bs.map((b) => b.y + b.h)),
    };
  };
  const dividers: number[] = [];
  for (let i = 0; i + 1 < bands.length; i++) {
    const lo = span(i).bottom;
    const hi = span(i + 1).top;
    // Every band holds a step (bandsOf), so both are numbers; guarded all
    // the same: an endless search here hung the page.
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      dividers.push(Number.isFinite(lo) ? lo + dividerClear : hi);
      continue;
    }
    const runs = along();
    const clear = (y: number) =>
      Math.min(
        y - lo,
        hi - y,
        ...runs.map((r) => (y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0)),
      );
    // Never through a label: a gap opened there would split it from the
    // stretch it sits beside.
    const inLabel = (y: number) =>
      routes.some((r) => r.label && y > r.label.y && y < r.label.y + r.label.h);
    let at = Math.round((lo + hi) / 2);
    for (let y = lo + 1; y < hi; y++)
      if (!inLabel(y) && (inLabel(at) || clear(y) > clear(at))) at = y;
    if (clear(at) < dividerClear) {
      // Open the gap: everything from there down moves by the room missing.
      openGap(nodes, routes, at, 2 * dividerClear);
      at += dividerClear;
    }
    dividers.push(at);
  }

  // Across: the header column, then the drawing.
  const { titles, head } = eyebrows(bands.map((b) => b.title));
  const rects = [
    ...nodes,
    ...routes.flatMap((r) => (r.label ? [r.label] : [])),
  ];
  const pts: Point[] = routes.flatMap((r) => r.points);
  const minX = Math.min(...rects.map((r) => r.x), ...pts.map((p) => p.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w), ...pts.map((p) => p.x));
  const minY = Math.min(...rects.map((r) => r.y), ...pts.map((p) => p.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h), ...pts.map((p) => p.y));
  const dx = head + headGap - minX;
  for (const b of nodes) b.x += dx;
  for (const r of routes) {
    for (const p of r.points) p.x += dx;
    if (r.label) r.label.x += dx;
  }
  const width = head + headGap + (maxX - minX) + headGap;
  const edgesY = [minY - bandPad, ...dividers, maxY + bandPad];
  const lanes: LaneBox[] = bands.map((b, i) => ({
    id: b.id,
    title: b.title,
    lines: titles[i],
    nodes: members[i],
    x: 0,
    y: edgesY[i],
    w: width,
    h: edgesY[i + 1] - edgesY[i],
  }));
  return { ...frame(nodes, routes, [], lanes), lanes, head };
}
