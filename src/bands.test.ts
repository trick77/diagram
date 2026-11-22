import { describe, it, expect, vi } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import type { FlowEdgeIR, FlowIR } from "./ir";
import {
  bandWidth,
  bandsOf,
  keeps,
  layoutBands,
  loopBacks,
  openGap,
} from "./bands";
import type { EdgeRoute, NodeBox } from "./layout";
import { check, checkSwimlane, maxLabelGap } from "./check/check";
import systemMap from "../testdata/maps/system-map.json";
import repoMap from "../testdata/maps/repo-map.json";

// The maps take the engine most of a second each, several times that under
// coverage on CI: past vitest's 5s the first test to lay the 22-box map out
// failed there.
vi.setConfig({ testTimeout: 20_000 });

const edge = (
  from: string,
  to: string,
  over: Partial<FlowEdgeIR> = {},
): FlowEdgeIR => ({
  from,
  to,
  label: "",
  dashed: false,
  head: "end",
  ...over,
});

/** A request handled across three roles, top down: a check that sends it
 * back up, a handoff down and a decision. */
const process: FlowIR = {
  kind: "flow",
  direction: "TB",
  zones: [
    { id: "req", title: "Requester" },
    { id: "app", title: "Approver" },
    { id: "fin", title: "Finance" },
  ],
  nodes: [
    { id: "a", label: "Submit request", shape: "pill", zone: "req" },
    { id: "e", label: "Revise request", shape: "step", zone: "req" },
    { id: "b", label: "Complete?", shape: "decision", zone: "app" },
    { id: "c", label: "Approve", shape: "step", zone: "app", focus: true },
    { id: "d", label: "Pay out", shape: "step", zone: "fin" },
  ],
  edges: [
    edge("a", "b"),
    edge("b", "c", { label: "yes" }),
    edge("b", "e", { label: "no" }),
    edge("e", "b"),
    edge("c", "d", { dashed: true }),
  ],
};

/** The 22-box map laid out once for every test that reads it: it takes
 * the longest of any, a second under coverage. */
let systemLaid: ReturnType<typeof layoutBands> | null = null;
const system = async () =>
  (await (systemLaid ??= layoutBands(systemMap as FlowIR, new ELK())))!;

const crossings = (l: Parameters<typeof check>[0]) =>
  check(l).filter((s) => s.endsWith(": cross")).length;

describe("layoutBands", () => {
  it("stacks the zones as bands, top to bottom in the order written", async () => {
    const l = (await layoutBands(process, new ELK()))!;
    expect(l.lanes.map((b) => [b.id, b.lines])).toEqual([
      ["req", ["REQUESTER"]],
      ["app", ["APPROVER"]],
      ["fin", ["FINANCE"]],
    ]);
    for (let i = 1; i < l.lanes.length; i++)
      expect(l.lanes[i].y).toBe(l.lanes[i - 1].y + l.lanes[i - 1].h);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("runs the flow down: a step below the one leading to it, unless it is a loop back", async () => {
    const l = (await layoutBands(process, new ELK()))!;
    const at = (id: string) => l.nodes.find((n) => n.id === id)!;
    expect(at("b").y).toBeGreaterThan(at("a").y);
    expect(at("d").y).toBeGreaterThan(at("c").y);
    // Revise sits in the requester's band, above the decision it returns
    // to. The loop back is the arrow closing the cycle, back to the
    // decision, as a left-to-right swimlane reads it: dashed, never the
    // warn colour. The branch up to Revise only points up, solid.
    expect(at("e").y).toBeLessThan(at("b").y);
    const back = l.edges.find((e) => e.from === "e" && e.to === "b")!;
    expect([back.dashed, back.warn]).toEqual([true, false]);
    const up = l.edges.find((e) => e.from === "b" && e.to === "e")!;
    expect(up.dashed).toBe(false);
  });

  it("draws an arrow against the bands' order solid when it closes no cycle", async () => {
    // A map's store feeding a service above it: a call up, not a loop.
    const l = (await layoutBands(
      {
        kind: "flow",
        direction: "TB",
        zones: [
          { id: "svc", title: "Services" },
          { id: "st", title: "Stores" },
        ],
        nodes: [
          { id: "q", label: "Queue", shape: "step", zone: "st" },
          { id: "w", label: "Worker", shape: "step", zone: "svc" },
        ],
        edges: [edge("q", "w", { label: "call" })],
      },
      new ELK(),
    ))!;
    expect(l.edges[0].dashed).toBe(false);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("keeps a dotted arrow the warn colour, and the focus", async () => {
    const l = (await layoutBands(process, new ELK()))!;
    const dotted = l.edges.find((e) => e.from === "c")!;
    expect([dotted.dashed, dotted.warn]).toEqual([true, true]);
    expect(l.nodes.find((n) => n.id === "c")!.focus).toBe(true);
  });

  it("puts the steps of no zone in a last band without a name", async () => {
    const l = (await layoutBands(
      {
        ...process,
        nodes: [...process.nodes, { id: "z", label: "Archive", shape: "step" }],
        edges: [...process.edges, edge("d", "z")],
      },
      new ELK(),
    ))!;
    const last = l.lanes[l.lanes.length - 1];
    expect([last.id, last.title, last.lines, last.nodes]).toEqual([
      "",
      "",
      [],
      ["z"],
    ]);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("declines an arrow from a step to itself, and a flow with no step", async () => {
    expect(
      await layoutBands(
        { ...process, edges: [...process.edges, edge("c", "c")] },
        new ELK(),
      ),
    ).toBeNull();
    expect(
      await layoutBands({ ...process, nodes: [], edges: [] }, new ELK()),
    ).toBeNull();
  });

  it("lays a repository map out by the rules, no arrow crossing another", async () => {
    const l = (await layoutBands(repoMap as FlowIR, new ELK()))!;
    expect(l.lanes.map((b) => b.id)).toEqual([
      "entry",
      "parts",
      "stores",
      "external",
    ]);
    expect(checkSwimlane(l)).toEqual([]);
    expect(crossings(l)).toBe(0);
    // An event back up out of the stores: dashed, in the warn colour.
    const up = l.edges.filter((e) => {
      const from = l.nodes.find((n) => n.id === e.from)!;
      const to = l.nodes.find((n) => n.id === e.to)!;
      return to.y < from.y;
    });
    expect(up.length).toBeGreaterThan(0);
    for (const e of up) expect([e.dashed, e.warn]).toEqual([true, true]);
    // The cycle through the event log closes on its dotted event, not on
    // the consumer's solid call: every solid arrow is drawn solid.
    for (const e of l.edges)
      if (!e.warn) expect(e.dashed, `${e.from}->${e.to}`).toBe(false);
  });

  it("breaks a cycle at a dotted arrow where one closes it", () => {
    const ir: FlowIR = {
      ...process,
      edges: [
        edge("a", "b"),
        edge("b", "c"),
        edge("c", "a", { dashed: true }),
        edge("c", "d"),
        edge("d", "b"),
      ],
    };
    // Walked as written, c->a closes the first cycle (dotted, fine) and
    // d->b the second: solid, as no dotted arrow closes it.
    expect([...loopBacks(ir)].sort()).toEqual([2, 4]);
    // Written the other way round, the solid arrow is still not taken
    // for the dotted one's cycle.
    const turned: FlowIR = {
      ...ir,
      edges: [edge("c", "a", { dashed: true }), edge("b", "c"), edge("a", "b")],
    };
    expect([...loopBacks(turned)]).toEqual([0]);
  });

  it("lays the 22-box system map out by the rules, its wide band wrapped", async () => {
    const l = await system();
    expect(l.lanes.map((b) => b.id)).toEqual([
      "clients",
      "entry",
      "repositories",
      "stores",
      "external",
    ]);
    expect(checkSwimlane(l)).toEqual([]);
    // Eight services, too many for one row of a page column: wrapped, the
    // drawing is no wider than twice its height. Unwrapped it was 2004px
    // by 837, centred on its neighbours 1413. It is still wider than a page
    // column (1222px at a flow's gaps and bold names): a number to move
    // only down.
    expect(l.width).toBeLessThan(2 * l.height);
    expect(l.width).toBeLessThanOrEqual(1230);
    expect(bandWidth).toBe(1080);
    expect(crossings(l)).toBeLessThanOrEqual(6);
  });

  it("starts the drawing one gap after the band names", async () => {
    for (const l of [
      await system(),
      (await layoutBands(repoMap as FlowIR, new ELK()))!,
      (await layoutBands(process, new ELK()))!,
    ]) {
      const content = l.lanes[0].x + l.head;
      const first = Math.min(...l.nodes.map((n) => n.x));
      expect(first - content).toBeLessThanOrEqual(24);
    }
  });

  it("starts no band of the 22-box map far in from its name", async () => {
    // A band of two boxes sits over the arrows it leads to. Centred on
    // their neighbours, the top bands' boxes began 593px in; pulled to the
    // shortest arrows, 335, and 370 at a flow's gaps: a number to move
    // only down.
    const l = await system();
    const content = l.lanes[0].x + l.head;
    for (const lane of l.lanes) {
      const lead =
        Math.min(
          ...lane.nodes.map((id) => l.nodes.find((n) => n.id === id)!.x),
        ) - content;
      expect(lead, lane.id).toBeLessThanOrEqual(375);
    }
  });

  it("sets every label beside its own arrow, most at its start", async () => {
    const l = await system();
    const gap = (e: (typeof l.edges)[number], k: number) => {
      const [a, b] = [e.points[k], e.points[k + 1]];
      const r = e.label!;
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
    let atStart = 0;
    for (const e of l.edges) {
      const d = e.points.slice(1).map((_, k) => gap(e, k));
      expect(Math.min(...d), `${e.from}->${e.to}`).toBeLessThanOrEqual(
        maxLabelGap,
      );
      if (d[0] <= maxLabelGap) atStart++;
    }
    expect(atStart).toBeGreaterThan(l.edges.length / 2);
  });
});

describe("bandsOf", () => {
  it("is the zones holding steps, as written, and a nameless one for the rest", () => {
    expect(
      bandsOf({
        kind: "flow",
        direction: "TB",
        zones: [
          { id: "x", title: "Empty" },
          { id: "y", title: "Held" },
        ],
        nodes: [
          { id: "a", label: "A", shape: "step", zone: "y" },
          { id: "b", label: "B", shape: "step", zone: "nowhere" },
        ],
        edges: [],
      }),
    ).toEqual([
      { id: "y", title: "Held", nodes: ["a"] },
      { id: "", title: "", nodes: ["b"] },
    ]);
  });

  it("puts the zones an order names first, in that order, the rest after as written", () => {
    const ir: FlowIR = {
      kind: "flow",
      direction: "TB",
      zones: ["external", "misc", "entry", "stores"].map((id) => ({
        id,
        title: id,
      })),
      nodes: ["external", "misc", "entry", "stores"].map((zone) => ({
        id: `n-${zone}`,
        label: zone,
        shape: "step" as const,
        zone,
      })),
      edges: [],
    };
    expect(
      bandsOf(ir, ["clients", "entry", "stores", "external"]).map((b) => b.id),
    ).toEqual(["entry", "stores", "external", "misc"]);
  });
});

describe("layoutBands with an order", () => {
  it("stacks the bands in the order asked, whatever order the zones came in", async () => {
    const shuffled: FlowIR = {
      ...(repoMap as FlowIR),
      zones: [...(repoMap as FlowIR).zones].reverse(),
    };
    const l = (await layoutBands(shuffled, new ELK(), [
      "entry",
      "parts",
      "stores",
      "external",
    ]))!;
    expect(l.lanes.map((b) => b.id)).toEqual([
      "entry",
      "parts",
      "stores",
      "external",
    ]);
    expect(checkSwimlane(l)).toEqual([]);
  });
});

describe("layoutBands on what a source can say", () => {
  it("draws zones of one id as one band, a zone with no id as the steps of none", async () => {
    // A model reopening its subgraph writes the zone twice; JSON can name
    // a zone "". Read apart, a band held no step, and its empty span sent
    // the dividers' search on for ever.
    const ir: FlowIR = {
      ...process,
      zones: [
        { id: "req", title: "Requester" },
        { id: "app", title: "Approver" },
        { id: "req", title: "Requester" },
        { id: "", title: "Nobody" },
        { id: "fin", title: "Finance" },
      ],
      nodes: process.nodes.map((n) => (n.id === "d" ? { ...n, zone: "" } : n)),
    };
    expect(bandsOf(ir).map((b) => [b.id, b.nodes])).toEqual([
      ["req", ["a", "e"]],
      ["app", ["b", "c"]],
      ["", ["d"]],
    ]);
    const l = (await layoutBands(ir, new ELK()))!;
    expect(l.lanes.map((b) => b.id)).toEqual(["req", "app", ""]);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("declines an arrow to a step it does not hold", async () => {
    expect(
      await layoutBands(
        { ...process, edges: [...process.edges, edge("c", "ghost")] },
        new ELK(),
      ),
    ).toBeNull();
  });
});

describe("openGap", () => {
  const box = (id: string, y: number): NodeBox => ({
    id,
    kind: "step",
    lines: [id],
    face: "sans",
    size: 13,
    bold: true,
    focus: false,
    x: 0,
    y,
    w: 100,
    h: 40,
  });
  const route = (
    points: [number, number][],
    label: { x: number; y: number },
  ): EdgeRoute => ({
    from: "a",
    to: "b",
    points: points.map(([x, y]) => ({ x, y })),
    dashed: false,
    warn: false,
    head: "end",
    label: { lines: ["CALL"], w: 30, h: 15, ...label },
  });

  it("moves a label with the stretch it sits beside, wherever the gap opens", () => {
    // A level stretch below the gap, its label above it and above the gap
    // too: the label goes down with its stretch.
    const level = route(
      [
        [50, 40],
        [50, 120],
        [200, 120],
        [200, 200],
      ],
      { x: 110, y: 97 },
    );
    // An upright stretch across the gap, its label beside it above the gap:
    // the stretch grows, the label stays.
    const upright = route(
      [
        [300, 40],
        [300, 200],
      ],
      { x: 308, y: 60 },
    );
    const nodes = [box("a", 0), box("b", 200)];
    openGap(nodes, [level, upright], 110, 16);
    expect(level.points[1].y).toBe(136);
    expect(level.label!.y).toBe(113);
    expect(upright.points[1].y).toBe(216);
    expect(upright.label!.y).toBe(60);
    expect(nodes[1].y).toBe(216);
  });
});

describe("keeps", () => {
  it("takes a narrower wrap only if it breaks no more rules", () => {
    const out = { rules: 0, width: 1400 };
    expect(keeps(out, { rules: 0, width: 1200 })).toBe(true);
    expect(keeps(out, { rules: 1, width: 900 })).toBe(false);
    expect(keeps(out, { rules: 0, width: 1500 })).toBe(false);
    expect(keeps({ rules: 2, width: 900 }, { rules: 1, width: 1300 })).toBe(
      true,
    );
  });
});
