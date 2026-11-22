import { describe, expect, it } from "vitest";
import { drawIR, engine } from "./render";
import type { ClassDiagramIR, ERIR, FlowIR, SequenceIR } from "./ir";

describe("drawIR", () => {
  const org: FlowIR = {
    kind: "flow",
    direction: "TB",
    nodes: ["r", "a", "b", "c", "a1", "a2", "b1", "b2"].map((id) => ({
      id,
      label: id,
      shape: "step" as const,
    })),
    edges: [
      ["r", "a"],
      ["r", "b"],
      ["r", "c"],
      ["a", "a1"],
      ["a", "a2"],
      ["b", "b1"],
      ["b", "b2"],
    ].map(([from, to]) => ({
      from,
      to,
      label: "",
      dashed: false,
      head: "end" as const,
    })),
    zones: [],
  };

  it("draws a top-down tree as an org chart unless told not to", async () => {
    expect((await drawIR(org, "t")).layout?.bus).toBe(true);
    expect((await drawIR(org, "t", { tree: false })).layout?.bus).toBe(
      undefined,
    );
  });

  it("draws an entity model with the engine", async () => {
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
    const { svg, layout } = await drawIR(er, "t");
    expect(layout).toBeNull();
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("ORDER");
    expect(svg).toContain("HOLDS");
  });

  it("hands back a flow's layout with its drawing", async () => {
    const flow: FlowIR = {
      kind: "flow",
      direction: "TB",
      nodes: [
        { id: "a", label: "Receive order", shape: "pill" },
        { id: "b", label: "Check stock", shape: "step" },
      ],
      edges: [{ from: "a", to: "b", label: "", dashed: false, head: "end" }],
      zones: [],
    };
    const { svg, layout } = await drawIR(flow, "t");
    expect(svg).toContain("Check stock");
    expect(layout?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("draws a class diagram with the engine", async () => {
    const cls: ClassDiagramIR = {
      kind: "class",
      direction: "TB",
      classes: [
        { id: "Order", label: "Order", fields: [], methods: [] },
        {
          id: "Line",
          label: "Line",
          fields: [{ text: "+qty int" }],
          methods: [],
        },
      ],
      rels: [
        {
          from: "Line",
          to: "Order",
          kind: "composition",
          dashed: false,
          label: "",
          fromCard: "1..*",
          toCard: "",
        },
      ],
    };
    const { svg, layout } = await drawIR(cls, "t");
    expect(layout).toBeNull();
    expect(svg).toContain("+qty int");
    expect(svg).toContain(">1..*</text>");
  });

  it("draws a sequence without a layout", async () => {
    const seq: SequenceIR = {
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
    const { svg, layout } = await drawIR(seq, "t");
    expect(layout).toBeNull();
    expect(svg).toContain("GET /orders");
  });
});

describe("engine", () => {
  it("loads the engine once for every caller", async () => {
    const [a, b] = await Promise.all([engine(), engine()]);
    expect(a).toBe(b);
  });
});
