import { describe, it, expect } from "vitest";
import type { FlowEdgeIR, SwimlaneIR } from "./ir";
import { asFlow, eyebrowWidth, layoutSwimlane } from "./swimlane";
import { check, checkSwimlane } from "./check/check";
import { drawSwimlane } from "./draw";
import { drawIR } from "./render";
import type { Palette } from "./theme";

const pal: Palette = {
  surface: "#151514",
  fg: "#ece8df",
  muted: "#a29e94",
  line: "#3b3935",
  tint: "#201f1c",
  accent: "#d97757",
  warn: "#e3a33f",
  sans: "Plex Sans",
  mono: "Plex Mono",
};

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

/** A request through three roles: a check that sends it back, a handoff
 * down and one up again. */
const request: SwimlaneIR = {
  kind: "swimlane",
  lanes: [
    { id: "req", title: "Requester" },
    { id: "app", title: "Approver" },
    { id: "fin", title: "Finance" },
  ],
  nodes: [
    { id: "a", label: "Submit request", shape: "step", lane: "req" },
    { id: "e", label: "Revise request", shape: "step", lane: "req" },
    { id: "b", label: "Complete?", shape: "decision", lane: "app" },
    { id: "c", label: "Approve", shape: "step", lane: "app", focus: true },
    { id: "d", label: "Pay out", shape: "step", lane: "fin" },
  ],
  edges: [
    edge("a", "b"),
    edge("b", "c", { label: "yes" }),
    edge("b", "e", { label: "no" }),
    edge("e", "b"),
    edge("c", "d", { dashed: true }),
  ],
};

const box = (l: ReturnType<typeof layoutSwimlane>, id: string) =>
  l!.nodes.find((n) => n.id === id)!;

describe("layoutSwimlane", () => {
  it("puts every step in its lane's band, the lanes in the order written", () => {
    const l = layoutSwimlane(request)!;
    expect(l.lanes.map((k) => k.id)).toEqual(["req", "app", "fin"]);
    expect(l.lanes.map((k) => k.lines)).toEqual([
      ["REQUESTER"],
      ["APPROVER"],
      ["FINANCE"],
    ]);
    for (const k of l.lanes) {
      for (const id of k.nodes) {
        const n = box(l, id);
        expect(n.y).toBeGreaterThanOrEqual(k.y);
        expect(n.y + n.h).toBeLessThanOrEqual(k.y + k.h);
        expect(n.x).toBeGreaterThanOrEqual(k.x + l.head);
      }
    }
    // One band under the next, sharing a divider.
    expect(l.lanes[1].y).toBe(l.lanes[0].y + l.lanes[0].h);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("runs the flow left to right, a step after the one before it", () => {
    const l = layoutSwimlane(request)!;
    const x = (id: string) => box(l, id).x;
    expect(x("b")).toBeGreaterThan(x("a"));
    expect(x("c")).toBeGreaterThan(x("b"));
    expect(x("e")).toBeGreaterThan(x("b"));
    expect(x("d")).toBeGreaterThan(x("c"));
  });

  it("hands off between lanes on square corners, a branch out of the diamond's corner", () => {
    const l = layoutSwimlane(request)!;
    const no = l.edges.find((e) => e.from === "b" && e.to === "e")!;
    const b = box(l, "b");
    // Up out of the diamond's top (beside the loop back coming in there),
    // then right into the step.
    const [p0, p1] = no.points;
    expect(p0.x).toBe(p1.x);
    expect(p1.y).toBeLessThan(p0.y);
    expect(p0.y).toBeLessThan(b.y + b.h / 2);
    expect(Math.abs(p0.x - (b.x + b.w / 2))).toBeLessThanOrEqual(16);
    expect(no.points).toHaveLength(3);
    expect(no.label!.lines).toEqual(["NO"]);
  });

  it("dashes a loop back and runs it over the steps where under them it would cross", () => {
    // Under the approver's lane, the loop cut the straight yes out of the
    // decision; over the requester's it meets nothing.
    const l = layoutSwimlane(request)!;
    const back = l.edges.find((e) => e.from === "e" && e.to === "b")!;
    expect(back.dashed).toBe(true);
    expect(back.warn).toBe(false);
    const highest = Math.min(...back.points.map((p) => p.y));
    expect(highest).toBeLessThan(Math.min(box(l, "e").y, box(l, "a").y));
    expect(highest).toBeGreaterThan(l.lanes[0].y);
    expect(check(l).filter((s) => s.endsWith("cross"))).toEqual([]);
  });

  it("runs a loop back under the steps when neither way crosses", () => {
    const l = layoutSwimlane({
      kind: "swimlane",
      lanes: [
        { id: "p", title: "Requester" },
        { id: "q", title: "Helper" },
      ],
      nodes: [
        { id: "a", label: "Ask", shape: "step", lane: "p" },
        { id: "b", label: "Try", shape: "step", lane: "q" },
        { id: "c", label: "Test", shape: "step", lane: "q" },
      ],
      edges: [
        edge("a", "b"),
        edge("b", "c"),
        edge("c", "b", { label: "again" }),
      ],
    })!;
    const back = l.edges[2];
    const lowest = Math.max(...back.points.map((p) => p.y));
    expect(lowest).toBeGreaterThan(box(l, "b").y + box(l, "b").h);
    expect(back.label!.lines).toEqual(["AGAIN"]);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("labels a loop back run over the steps above its line", () => {
    const l = layoutSwimlane({
      ...request,
      edges: request.edges.map((e) =>
        e.from === "e" ? { ...e, label: "resubmit" } : e,
      ),
    })!;
    const back = l.edges.find((e) => e.from === "e")!;
    const top = Math.min(...back.points.map((p) => p.y));
    expect(back.label!.y + back.label!.h).toBeLessThan(top);
    expect(back.label!.y).toBeGreaterThan(l.lanes[0].y);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("keeps a dotted arrow the warn colour, and its own dash", () => {
    const l = layoutSwimlane(request)!;
    const dotted = l.edges.find((e) => e.from === "c")!;
    expect(dotted.warn).toBe(true);
    expect(dotted.dashed).toBe(true);
  });

  it("runs an arrow straight along its lane", () => {
    const l = layoutSwimlane({
      kind: "swimlane",
      lanes: [
        { id: "p", title: "Requester" },
        { id: "q", title: "Helper" },
      ],
      nodes: [
        { id: "a", label: "Ask", shape: "pill", lane: "p" },
        { id: "b", label: "Wait", shape: "step", lane: "p" },
        { id: "x", label: "Answer", shape: "step", lane: "q" },
      ],
      edges: [edge("a", "b", { label: "sent" }), edge("b", "x")],
    })!;
    const ab = l.edges[0];
    expect(ab.points).toHaveLength(2);
    expect(ab.points[0].y).toBe(ab.points[1].y);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("runs an arrow past a step in its way over the top of its lane", () => {
    const l = layoutSwimlane({
      kind: "swimlane",
      lanes: [
        { id: "p", title: "Author" },
        { id: "q", title: "Editor" },
      ],
      nodes: [
        { id: "a", label: "Draft", shape: "step", lane: "p" },
        { id: "b", label: "Revise", shape: "step", lane: "p" },
        { id: "c", label: "Publish", shape: "step", lane: "p" },
        { id: "e", label: "Edit", shape: "step", lane: "q" },
      ],
      edges: [
        edge("a", "b"),
        edge("b", "c"),
        edge("a", "c", { label: "urgent" }),
        edge("c", "e"),
      ],
    })!;
    const skip = l.edges[2];
    expect(skip.points).toHaveLength(6);
    const top = Math.min(...skip.points.map((p) => p.y));
    for (const id of ["a", "b", "c"]) expect(top).toBeLessThan(box(l, id).y);
    expect(top).toBeGreaterThan(l.lanes[0].y);
    // It leaves above the arrow along the lane, and enters above it too.
    expect(skip.points[0].y).toBeLessThan(l.edges[0].points[0].y);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("wraps a long lane name and makes its header wide enough", () => {
    const l = layoutSwimlane({
      kind: "swimlane",
      lanes: [
        { id: "p", title: "Accounts payable clerk on duty" },
        { id: "q", title: "Q" },
      ],
      nodes: [
        { id: "a", label: "A", shape: "step", lane: "p" },
        { id: "b", label: "B", shape: "step", lane: "q" },
      ],
      edges: [edge("a", "b"), edge("b", "a")],
    })!;
    expect(l.lanes[0].lines.length).toBeGreaterThan(1);
    for (const line of l.lanes[0].lines)
      expect(eyebrowWidth(line)).toBeLessThanOrEqual(l.head);
    expect(checkSwimlane(l)).toEqual([]);
  });

  it("declines a shape it cannot route, for the flow layout to draw", async () => {
    // Two steps in one cell, and a loop back out of the upper one: its
    // way down would run through the lower.
    const ir: SwimlaneIR = {
      kind: "swimlane",
      lanes: [
        { id: "p", title: "P" },
        { id: "q", title: "Q" },
      ],
      nodes: [
        { id: "a", label: "Start", shape: "step", lane: "p" },
        { id: "x", label: "Upper", shape: "step", lane: "q" },
        { id: "y", label: "Lower", shape: "step", lane: "q" },
      ],
      edges: [edge("a", "x"), edge("a", "y"), edge("x", "a")],
    };
    expect(layoutSwimlane(ir)).toBeNull();
    const { svg, layout } = await drawIR(ir, "t", { palette: pal });
    expect(svg).toContain("Upper");
    // Drawn as its flow, the lanes as zones.
    expect(layout!.zones.map((z) => z.id)).toEqual(["p", "q"]);
  });

  it("reads back as its flow", () => {
    const f = asFlow(request);
    expect(f.direction).toBe("LR");
    expect(f.zones).toEqual(request.lanes);
    expect(f.nodes[0]).toEqual({
      id: "a",
      label: "Submit request",
      shape: "step",
      zone: "req",
    });
  });
});

describe("drawSwimlane", () => {
  it("draws one frame, a divider between lanes and the names as eyebrows", () => {
    const svg = drawSwimlane(layoutSwimlane(request)!, pal, "t");
    expect(svg).toContain(">REQUESTER</text>");
    expect(svg).toContain('letter-spacing="0.08em"');
    // Two dividers between three lanes, one after the header column.
    expect(
      svg.match(new RegExp(`<line[^>]*stroke="${pal.line}"`, "g")),
    ).toHaveLength(3);
  });

  it("frames the lanes once: no second line round the drawing", () => {
    const svg = drawSwimlane(layoutSwimlane(request)!, pal, "t");
    // Steps are framed in the line colour too, but never at the drawing's
    // corner: a line there is a frame round the whole.
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const atCorner = [...doc.querySelectorAll("rect")].filter(
      (r) =>
        r.getAttribute("stroke") !== null &&
        Number(r.getAttribute("x") ?? 0) < 1 &&
        Number(r.getAttribute("y") ?? 0) < 1,
    );
    expect(atCorner).toHaveLength(0);
  });

  it("draws the focus in the accent, a loop back dashed, a dotted arrow in warn", () => {
    const svg = drawSwimlane(layoutSwimlane(request)!, pal, "t");
    expect(svg).toContain(`stroke="${pal.accent}"`);
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain(`stroke="${pal.warn}"`);
    expect(svg).toContain("t-warn");
  });

  it("escapes every text", () => {
    const svg = drawSwimlane(
      layoutSwimlane({
        ...request,
        lanes: [{ id: "req", title: "<Requester>" }, ...request.lanes.slice(1)],
        nodes: request.nodes.map((n) =>
          n.id === "a" ? { ...n, label: "Sign <form> & go" } : n,
        ),
      })!,
      pal,
      "t",
    );
    expect(svg).toContain("&lt;REQUESTER&gt;");
    expect(svg).toContain("Sign &lt;form&gt; &amp; go");
    expect(svg).not.toContain("<form>");
  });

  it("is what drawIR draws, with the layout handed back", async () => {
    const { svg, layout } = await drawIR(request, "t", { palette: pal });
    expect(svg).toContain(">APPROVER</text>");
    expect(layout!.nodes.map((n) => n.id).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
});
