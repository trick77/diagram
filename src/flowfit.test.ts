import { describe, expect, it, vi } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";

// check as it is, but a test can make one call report a problem: a spine or
// an org chart check refuses is not found in the corpus.
const forced = vi.hoisted(() => ({ next: false, lanes: false }));
vi.mock("./check/check", async (original) => {
  const real = await original<typeof import("./check/check")>();
  return {
    ...real,
    check: (...args: Parameters<typeof real.check>) => {
      if (forced.next) {
        forced.next = false;
        return ["forced"];
      }
      return real.check(...args);
    },
    // Lanes a test says break a rule, every time they are asked.
    checkSwimlane: (...args: Parameters<typeof real.checkSwimlane>) =>
      forced.lanes ? ["forced lanes"] : real.checkSwimlane(...args),
  };
});

import { lanesOf, layoutFlowChecked, layoutSwimlaneChecked } from "./flowfit";
import { asFlow, layoutSwimlane } from "./swimlane";
import { layoutFlow, layoutSpine } from "./layout";
import { check } from "./check/check";
import type { FlowEdgeIR, FlowIR } from "./ir";

const e = (from: string, to: string, label = ""): FlowEdgeIR => ({
  from,
  to,
  label,
  dashed: false,
  head: "end",
});
const flow = (
  nodes: [string, string, "step" | "decision"][],
  edges: FlowEdgeIR[],
): FlowIR => ({
  kind: "flow",
  direction: "TB",
  nodes: nodes.map(([id, label, shape]) => ({ id, label, shape })),
  edges,
  zones: [],
});

// Two branches merging into one end node, the other branch beside them. In
// the order written the engine crossed h->i over g->j and c->j.
const merge = flow(
  [
    ["a", "Loan due date passes", "step"],
    ["b", "Returned?", "decision"],
    ["c", "Close the loan", "step"],
    ["d", "Add overdue fee", "step"],
    ["e", "Send a reminder", "step"],
    ["f", "Fee settled?", "decision"],
    ["g", "Loan cleared", "step"],
    ["h", "Block the card", "step"],
    ["i", "Refer to collections", "step"],
    ["j", "Archive the record", "step"],
  ],
  [
    e("a", "b"),
    e("b", "c", "Yes"),
    e("b", "d", "No"),
    e("d", "e"),
    e("e", "f"),
    e("f", "g", "Yes"),
    e("f", "h", "No"),
    e("h", "i"),
    e("g", "j"),
    e("c", "j"),
  ],
);

/** counted is the engine, counting how often it is asked for. */
function counted() {
  const asked = { n: 0 };
  return { asked, elk: async () => (asked.n++, new ELK()) };
}

describe("layoutFlowChecked", () => {
  it("lays a flow the written order crosses out again, free of the order", async () => {
    expect(check(await layoutFlow(merge, async () => new ELK()))).not.toEqual(
      [],
    );
    expect(
      check(await layoutFlowChecked(merge, async () => new ELK())),
    ).toEqual([]);
  });

  // A branch that rejoins: no spine, no tree, the engine's from the start.
  it("keeps the engine's written order where it draws clean", async () => {
    const rejoin = flow(
      [
        ["a", "Start", "step"],
        ["b", "Ok?", "decision"],
        ["c", "Fix", "step"],
        ["d", "Ship", "step"],
        ["x", "Done", "step"],
      ],
      [
        e("a", "b"),
        e("b", "c", "no"),
        e("b", "d", "yes"),
        e("c", "x"),
        e("d", "x"),
      ],
    );
    const { asked, elk } = counted();
    const first = await layoutFlow(rejoin, elk);
    expect(layoutSpine(rejoin)).toBeNull();
    expect(first.bus).toBeUndefined();
    expect(asked.n).toBe(1);
    expect(check(first)).toEqual([]);
    expect(await layoutFlowChecked(rejoin, elk)).toEqual(first);
    // Clean the first time: no second layout.
    expect(asked.n).toBe(2);
  });

  // The retry left the spine and the org chart where they were: only the
  // engine read `free`. Refused, they are laid out by the engine, free.
  it("hands a spine or an org chart the rules refuse to the engine", async () => {
    const chain = flow(
      [
        ["a", "One", "step"],
        ["b", "Two", "step"],
        ["c", "Three", "step"],
      ],
      [e("a", "b"), e("b", "c")],
    );
    expect(layoutSpine(chain)).not.toBeNull();
    const { asked, elk } = counted();
    forced.next = true;
    const l = await layoutFlowChecked(chain, elk);
    expect(asked.n).toBe(1);
    expect(l).not.toEqual(layoutSpine(chain));

    const org = flow(
      ["r", "a", "b", "c", "a1", "a2", "b1", "b2"].map(
        (id) => [id, id, "step"] as [string, string, "step"],
      ),
      [
        e("r", "a"),
        e("r", "b"),
        e("r", "c"),
        e("a", "a1"),
        e("a", "a2"),
        e("b", "b1"),
        e("b", "b2"),
      ],
    );
    expect((await layoutFlow(org, elk)).bus).toBe(true);
    forced.next = true;
    expect((await layoutFlowChecked(org, elk)).bus).toBeUndefined();
  });
});

/** Three roles top-down, a request handed down and an answer back up. */
const zoned = (over: Partial<FlowIR> = {}): FlowIR => ({
  kind: "flow",
  direction: "TB",
  zones: [
    { id: "p", title: "Requester" },
    { id: "q", title: "Helper" },
  ],
  nodes: [
    { id: "a", label: "Ask", shape: "step", zone: "p" },
    { id: "b", label: "Answer", shape: "step", zone: "q" },
    { id: "c", label: "Read", shape: "step", zone: "p" },
  ],
  edges: [e("a", "b"), e("b", "c")],
  ...over,
});
const elk = async () => new ELK();

describe("lanes on request", () => {
  it("keeps the zoned flow where the lanes break more rules", async () => {
    forced.lanes = true;
    try {
      const l = await layoutFlowChecked(zoned(), elk, { lanes: true });
      expect("lanes" in l).toBe(false);
      expect(l.zones.map((z) => z.id)).toEqual(["p", "q"]);
      const s = await layoutSwimlaneChecked(
        {
          kind: "swimlane",
          direction: "TB",
          lanes: zoned().zones,
          nodes: zoned().nodes.map(({ zone, ...n }) => ({ ...n, lane: zone! })),
          edges: zoned().edges,
        },
        elk,
      );
      expect("lanes" in s).toBe(false);
    } finally {
      forced.lanes = false;
    }
    expect(
      "lanes" in (await layoutFlowChecked(zoned(), elk, { lanes: true })),
    ).toBe(true);
  });

  it("lets a mapping stay a mapping, and top-down zones nothing hands between stay zones", async () => {
    const mapping: FlowIR = zoned({
      direction: "LR",
      nodes: [
        { id: "a", label: "Event", shape: "step", zone: "p" },
        { id: "b", label: "Handler", shape: "step", zone: "q" },
      ],
      edges: [e("a", "b")],
    });
    expect(await lanesOf(mapping, elk)).toBeNull();
    const apart = zoned({ edges: [e("a", "c")] });
    expect(await lanesOf(apart, elk)).toBeNull();
  });

  it("drops empty zones, merges zones of one id or one title, and needs two roles", async () => {
    const l = (await lanesOf(
      zoned({
        zones: [
          { id: "p", title: "Requester" },
          { id: "empty", title: "Nobody" },
          { id: "q", title: "Helper" },
          { id: "p", title: "Requester again" },
          { id: "p2", title: "Requester" },
        ],
        nodes: [
          { id: "a", label: "Ask", shape: "step", zone: "p" },
          { id: "b", label: "Answer", shape: "step", zone: "q" },
          { id: "c", label: "Read", shape: "step", zone: "p2" },
        ],
      }),
      elk,
    ))!;
    expect(l.lanes.map((b) => [b.id, b.title, b.nodes])).toEqual([
      ["p", "Requester", ["a", "c"]],
      ["q", "Helper", ["b"]],
    ]);
    const one = zoned({ zones: [{ id: "p", title: "Requester" }] });
    expect(await lanesOf(one, elk)).toBeNull();
  });

  it("reads a step in an undeclared zone as in none: no swimlane, a last band", async () => {
    const ghost = (direction: "LR" | "TB") =>
      zoned({
        direction,
        nodes: [
          ...zoned().nodes,
          { id: "g", label: "Elsewhere", shape: "step", zone: "ghost" },
        ],
        edges: [...zoned().edges, e("c", "g")],
      });
    // Left to right a swimlane needs every step in a lane: none, no throw.
    expect(await lanesOf(ghost("LR"), elk)).toBeNull();
    const l = (await lanesOf(ghost("TB"), elk))!;
    expect(l.lanes.map((b) => [b.id, b.nodes])).toEqual([
      ["p", ["a", "c"]],
      ["q", ["b"]],
      ["", ["g"]],
    ]);
  });

  it("orders the bands by zone ids merged into one lane", async () => {
    const ir = zoned({
      zones: [
        { id: "p", title: "Requester" },
        { id: "q", title: "Helper" },
        { id: "p2", title: "Requester" },
      ],
      nodes: [
        { id: "a", label: "Ask", shape: "step", zone: "p" },
        { id: "b", label: "Answer", shape: "step", zone: "q" },
        { id: "c", label: "Read", shape: "step", zone: "p2" },
      ],
    });
    // p2 is the requester's lane, p: asked first, it comes first.
    const l = (await lanesOf(ir, elk, ["p2", "q"]))!;
    expect(l.lanes.map((b) => b.id)).toEqual(["p", "q"]);
    const turned = (await lanesOf(ir, elk, ["q", "p2"]))!;
    expect(turned.lanes.map((b) => b.id)).toEqual(["q", "p"]);
  });

  it("draws a top-down swimlane's bands in the order asked", async () => {
    const ir = zoned();
    const s = {
      kind: "swimlane" as const,
      direction: "TB" as const,
      lanes: ir.zones,
      nodes: ir.nodes.map(({ zone, ...n }) => ({ ...n, lane: zone! })),
      edges: ir.edges,
    };
    const l = (await layoutSwimlaneChecked(s, elk, {
      bandOrder: ["q", "p"],
    })) as unknown as { lanes: { id: string }[] };
    expect(l.lanes.map((b) => b.id)).toEqual(["q", "p"]);
    // Laid out left to right by code, a top-down swimlane is declined: its
    // bands are the engine's (layoutBands).
    expect(layoutSwimlane(s)).toBeNull();
  });

  it("checks a top-down swimlane as the flow it is drawn as when its lanes break more rules", async () => {
    const ir = zoned();
    forced.lanes = true;
    try {
      const l = await layoutSwimlaneChecked(
        {
          kind: "swimlane",
          lanes: ir.zones,
          nodes: ir.nodes.map(({ zone, ...n }) => ({ ...n, lane: zone! })),
          edges: ir.edges,
        },
        elk,
      );
      expect(l).toEqual(
        await layoutFlowChecked(
          asFlow({
            kind: "swimlane",
            lanes: ir.zones,
            nodes: ir.nodes.map(({ zone, ...n }) => ({ ...n, lane: zone! })),
            edges: ir.edges,
          }),
          elk,
        ),
      );
    } finally {
      forced.lanes = false;
    }
  });
});
