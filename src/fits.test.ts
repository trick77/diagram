import { describe, it, expect } from "vitest";
import { fits } from "./fits";
import type {
  ClassDiagramIR,
  ERIR,
  FlowIR,
  MindNodeIR,
  MindmapIR,
  SequenceIR,
  SwimlaneIR,
} from "./ir";

const node = (id: string) => ({ id, label: id, shape: "step" as const });

const flow = (n: number, e = 0): FlowIR => ({
  kind: "flow",
  direction: "TB",
  nodes: Array.from({ length: n }, (_, i) => node(`n${i}`)),
  edges: Array.from({ length: e }, (_, i) => ({
    from: "n0",
    to: `n${i % n}`,
    label: "",
    dashed: false,
    head: "end" as const,
  })),
  zones: [],
});

const message = {
  type: "message" as const,
  from: "a",
  to: "b",
  label: "x",
  line: "solid" as const,
  head: "filled" as const,
};

const sequence = (messages: number): SequenceIR => ({
  kind: "sequence",
  actors: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
  rows: [
    { type: "frame", keyword: "loop", label: "" },
    ...Array.from({ length: messages }, () => message),
    { type: "end" },
  ],
});

describe("fits", () => {
  it("takes a flow up to sixteen nodes and twenty-four edges", () => {
    expect(fits(flow(16, 24))).toBe(true);
    expect(fits(flow(17))).toBe(false);
    expect(fits(flow(4, 25))).toBe(false);
  });

  it("takes no flow without a node: there is nothing to draw", () => {
    expect(fits(flow(0))).toBe(false);
  });

  it("takes the caller's caps over the defaults, a map's larger ones", () => {
    expect(fits(flow(22, 33), { nodes: 22, edges: 33 })).toBe(true);
    expect(fits(flow(23), { nodes: 22, edges: 33 })).toBe(false);
  });

  it("counts a sequence's messages and notes, not its frames", () => {
    expect(fits(sequence(20))).toBe(true);
    expect(fits(sequence(21))).toBe(false);
  });

  it("counts every row, frames included, when asked to", () => {
    const s = sequence(18);
    expect(fits(s, { countFrames: true })).toBe(true);
    s.rows.push({ type: "frame", keyword: "opt", label: "" });
    expect(fits(s, { countFrames: true })).toBe(false);
    expect(fits(s)).toBe(true);
  });

  it("holds an entity model to fewer tables and fields", () => {
    const er = (n: number, attrs: number): ERIR => ({
      kind: "er",
      direction: "LR",
      entities: Array.from({ length: n }, (_, i) => ({
        id: `e${i}`,
        label: `E${i}`,
        attrs: Array.from({ length: attrs }, (_, j) => ({
          type: "int",
          name: `f${j}`,
          keys: [],
          comment: "",
        })),
      })),
      rels: [],
    });
    expect(fits(er(8, 12))).toBe(true);
    expect(fits(er(9, 1))).toBe(false);
    expect(fits(er(1, 13))).toBe(false);
  });

  it("takes a mindmap up to eight branches, four children each, three deep", () => {
    // A node with `wide` children, each with the same below it, `deep`
    // levels down.
    const tree = (wide: number, deep: number): MindNodeIR => ({
      label: "x",
      children:
        deep === 0
          ? []
          : Array.from({ length: wide }, () => tree(wide, deep - 1)),
    });
    const mindmap = (root: MindNodeIR): MindmapIR => ({
      kind: "mindmap",
      root,
    });
    const eight = (leaves: MindNodeIR[]) =>
      mindmap({
        label: "r",
        children: Array.from({ length: 8 }, () => ({
          label: "b",
          children: leaves,
        })),
      });
    expect(fits(eight([tree(4, 1)]))).toBe(true);
    expect(fits(eight(Array.from({ length: 4 }, () => tree(4, 1))))).toBe(true);
    expect(fits(mindmap(tree(9, 1)))).toBe(false);
    expect(fits(eight(Array.from({ length: 5 }, () => tree(0, 0))))).toBe(
      false,
    );
    // A leaf's own children are held to the same four, and end there.
    expect(fits(eight([tree(5, 1)]))).toBe(false);
    expect(fits(eight([tree(1, 2)]))).toBe(false);
    expect(fits(mindmap(tree(2, 3)), { mindmapDepth: 2 })).toBe(false);
    // The layout draws three levels; raised past them, a fourth would
    // vanish from the picture without a word.
    expect(fits(mindmap(tree(2, 3)), { mindmapDepth: 4 })).toBe(true);
    expect(fits(mindmap(tree(2, 4)), { mindmapDepth: 4 })).toBe(false);
  });

  it("takes up to five lanes, and a flow's steps and arrows", () => {
    const swim = (lanes: number, n: number, e = 0): SwimlaneIR => ({
      kind: "swimlane",
      lanes: Array.from({ length: lanes }, (_, i) => ({
        id: `l${i}`,
        title: `L${i}`,
      })),
      nodes: Array.from({ length: n }, (_, i) => ({
        ...node(`n${i}`),
        lane: `l${i % lanes}`,
      })),
      edges: flow(n, e).edges,
    });
    expect(fits(swim(5, 16, 24))).toBe(true);
    expect(fits(swim(6, 6))).toBe(false);
    expect(fits(swim(2, 17))).toBe(false);
    expect(fits(swim(2, 4, 25))).toBe(false);
  });

  it("counts a flow's lanes as drawn when it is drawn in lanes", () => {
    // Eight steps in a chain across the zones, top-down.
    const zoned = (zones: number, over: Partial<FlowIR> = {}): FlowIR => {
      const f = flow(8);
      return {
        ...f,
        zones: Array.from({ length: zones }, (_, i) => ({
          id: `z${i}`,
          title: `Z${i}`,
        })),
        nodes: f.nodes.map((n, i) => ({ ...n, zone: `z${i % zones}` })),
        edges: f.nodes.slice(1).map((n, i) => ({
          from: `n${i}`,
          to: n.id,
          label: "",
          dashed: false,
          head: "end" as const,
        })),
        ...over,
      };
    };
    expect(fits(zoned(5), {}, { lanes: true })).toBe(true);
    expect(fits(zoned(6), {}, { lanes: true })).toBe(false);
    // Zones as zones are not lanes; a map's own cap lets seven through.
    expect(fits(zoned(7))).toBe(true);
    expect(fits(zoned(7), { lanes: 7 }, { lanes: true })).toBe(true);

    // Zones of one title are one lane: six zones, five lanes.
    const merged = zoned(6, {
      zones: [0, 1, 2, 3, 4, 5].map((i) => ({
        id: `z${i}`,
        title: `Z${i === 5 ? 0 : i}`,
      })),
    });
    expect(fits(merged, {}, { lanes: true })).toBe(true);

    // Steps in no zone are one more band top-down: five zones, six bands.
    const loose = zoned(5);
    loose.nodes.push({ id: "x", label: "x", shape: "step" });
    loose.edges.push({
      from: "n7",
      to: "x",
      label: "",
      dashed: false,
      head: "end",
    });
    expect(fits(loose, {}, { lanes: true })).toBe(false);

    // Not lanes at all (left to right, a step in no zone): no lane cap, its
    // zones are drawn as zones.
    const asZones: FlowIR = { ...loose, direction: "LR" };
    expect(fits(asZones, { lanes: 2 }, { lanes: true })).toBe(true);
  });

  it("holds a class diagram to eight classes, twelve relations, ten members each", () => {
    const member = { text: "+x int" };
    const cls = (n: number, rels: number, fields = 0, methods = 0) => {
      const ir: ClassDiagramIR = {
        kind: "class",
        direction: "TB",
        classes: Array.from({ length: n }, (_, i) => ({
          id: `C${i}`,
          label: `C${i}`,
          fields: Array.from({ length: fields }, () => member),
          methods: Array.from({ length: methods }, () => member),
        })),
        rels: Array.from({ length: rels }, () => ({
          from: "C0",
          to: "C1",
          kind: "association" as const,
          dashed: false,
          label: "",
          fromCard: "",
          toCard: "",
        })),
      };
      return ir;
    };
    expect(fits(cls(8, 12, 5, 5))).toBe(true);
    expect(fits(cls(9, 1))).toBe(false);
    expect(fits(cls(2, 13))).toBe(false);
    expect(fits(cls(2, 1, 6, 5))).toBe(false);
    expect(fits(cls(9, 1), { classes: 9 })).toBe(true);
  });
});
