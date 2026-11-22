import { describe, it, expect } from "vitest";
import { checkIR } from "./index";
import type {
  ClassDiagramIR,
  DiagramIR,
  ERIR,
  FlowEdgeIR,
  FlowIR,
  MindmapIR,
  QuadrantIR,
  SequenceIR,
  SwimlaneIR,
  TimelineIR,
} from "../ir";
import { layoutFlow, type FlowLayout } from "../layout";
import { asFlow } from "../swimlane";
import { engine } from "../render";

const edge = (from: string, to: string): FlowEdgeIR => ({
  from,
  to,
  label: "",
  dashed: false,
  head: "end",
});
const step = (id: string) => ({ id, label: id, shape: "step" as const });

const flow: FlowIR = {
  kind: "flow",
  direction: "TB",
  nodes: [step("a"), { ...step("b"), shape: "decision" }, step("c"), step("d")],
  edges: [edge("a", "b"), edge("b", "c"), edge("b", "d"), edge("d", "c")],
  zones: [],
};

const org: FlowIR = {
  kind: "flow",
  direction: "TB",
  nodes: ["r", "a", "b", "c", "a1", "a2", "b1", "b2"].map(step),
  edges: [
    edge("r", "a"),
    edge("r", "b"),
    edge("r", "c"),
    edge("a", "a1"),
    edge("a", "a2"),
    edge("b", "b1"),
    edge("b", "b2"),
  ],
  zones: [],
};

const mapping: FlowIR = {
  kind: "flow",
  direction: "LR",
  nodes: [
    { ...step("e1"), zone: "E" },
    { ...step("e2"), zone: "E" },
    { ...step("t1"), zone: "T" },
  ],
  edges: [edge("e1", "t1"), edge("e2", "t1")],
  zones: [
    { id: "E", title: "Event" },
    { id: "T", title: "Topic" },
  ],
};

const sequence: SequenceIR = {
  kind: "sequence",
  actors: [
    { id: "c", label: "Client" },
    { id: "s", label: "Server" },
  ],
  rows: [
    {
      type: "message",
      from: "c",
      to: "s",
      label: "GET /orders",
      line: "solid",
      head: "filled",
    },
  ],
};

const er: ERIR = {
  kind: "er",
  direction: "TB",
  entities: [
    { id: "ORDER", label: "ORDER", attrs: [] },
    { id: "LINE", label: "LINE", attrs: [] },
  ],
  rels: [
    {
      from: "ORDER",
      to: "LINE",
      label: "holds",
      fromCard: "one",
      toCard: "zeroOrMore",
      dashed: false,
    },
  ],
};

const mindmap: MindmapIR = {
  kind: "mindmap",
  root: {
    label: "Shop",
    children: [
      { label: "Orders", children: [{ label: "Returns", children: [] }] },
      { label: "Stock", children: [] },
    ],
  },
};

const timeline: TimelineIR = {
  kind: "timeline",
  title: "Rollout",
  periods: [
    { label: "Q1", events: ["Pilot"] },
    { label: "Q2", events: ["Launch", "Review"] },
  ],
};

const quadrant: QuadrantIR = {
  kind: "quadrant",
  title: "",
  xAxis: "Effort",
  yAxis: "Value",
  quadrants: ["Do", "Plan", "Drop", "Delegate"],
  points: [
    { label: "Search", x: 0.2, y: 0.8, focus: true },
    { label: "Export", x: 0.7, y: 0.3 },
  ],
};

const swimlane: SwimlaneIR = {
  kind: "swimlane",
  lanes: [
    { id: "c", title: "Customer" },
    { id: "s", title: "Shop" },
  ],
  nodes: [
    { ...step("order"), lane: "c" },
    { ...step("pack"), lane: "s" },
    { ...step("ship"), lane: "s" },
  ],
  edges: [edge("order", "pack"), edge("pack", "ship")],
};

const classes: ClassDiagramIR = {
  kind: "class",
  direction: "TB",
  classes: [
    { id: "Repo", label: "Repo", fields: [], methods: [{ text: "+find(id)" }] },
    { id: "OrderRepo", label: "OrderRepo", fields: [], methods: [] },
  ],
  rels: [
    {
      from: "OrderRepo",
      to: "Repo",
      kind: "inheritance",
      dashed: false,
      label: "",
      fromCard: "",
      toCard: "",
    },
  ],
};

describe("checkIR", () => {
  const all: [string, DiagramIR][] = [
    ["flow", flow],
    ["org chart", org],
    ["mapping", mapping],
    ["sequence", sequence],
    ["er", er],
    ["mindmap", mindmap],
    ["timeline", timeline],
    ["quadrant", quadrant],
    ["swimlane", swimlane],
    ["class", classes],
  ];
  for (const [name, ir] of all)
    it(`passes a well-drawn ${name}`, async () => {
      expect(await checkIR(ir)).toEqual([]);
    });

  it("checks a tree as the layout drawIR gives it, the org chart or not", async () => {
    expect(await checkIR(org, { tree: false })).toEqual([]);
  });

  // drawIR hands back the flow layout of a swimlane its lanes declined:
  // read as lanes, it threw on the missing lanes.
  it("checks a swimlane handed as the flow it was drawn as", async () => {
    const drawn = await layoutFlow(asFlow(swimlane), engine);
    expect(await checkIR(swimlane, { layout: drawn })).toEqual([]);
  });

  it("checks a layout it is handed instead of laying one out", async () => {
    // A label far wider than its box: no layout of the package's draws it.
    const bad: FlowLayout = {
      width: 200,
      height: 100,
      nodes: [
        {
          id: "a",
          kind: "step",
          lines: ["a label far too wide for a box this narrow"],
          face: "sans",
          size: 13,
          bold: false,
          focus: false,
          x: 0,
          y: 0,
          w: 80,
          h: 40,
        },
      ],
      edges: [],
      zones: [],
    };
    expect(await checkIR(flow, { layout: bad })).toEqual([
      'a: "a label far too wide for a box this narrow" overflows its box',
    ]);
  });
});
