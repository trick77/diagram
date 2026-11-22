import { describe, expect, it } from "vitest";
import { drawIR, engine } from "./render";
import type { ClassDiagramIR, ERIR, FlowIR, SequenceIR } from "./ir";
import type { Palette } from "./theme";
import systemMap from "../testdata/maps/system-map.json";
import repoMap from "../testdata/maps/repo-map.json";

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

  it("draws a zoned top-down flow in bands when asked, its boxes handed back", async () => {
    const map = systemMap as FlowIR;
    const { svg, layout, laid } = await drawIR(map, "t", {
      lanes: true,
      palette: pal,
    });
    expect(svg).toContain(">REPOSITORIES</text>");
    expect(layout).toBe(laid);
    expect(layout !== null && "lanes" in layout).toBe(true);
    // Every box, for a consumer's links over the drawing.
    expect(layout!.nodes.map((n) => n.id).sort()).toEqual(
      map.nodes.map((n) => n.id).sort(),
    );
    // The 22-box map takes the engine most of a second, more under coverage.
  }, 20_000);

  it("stacks the bands in the order asked; not asked for lanes, the zones stay zones", async () => {
    // The repository map: a quarter of the system map's layout time.
    const map = repoMap as FlowIR;
    const order = ["entry", "parts", "stores", "external"];
    const turned = await drawIR(
      { ...map, zones: [...map.zones].reverse() },
      "t",
      { lanes: true, bandOrder: order, palette: pal },
    );
    expect(
      (turned.laid as { lanes: { id: string }[] }).lanes.map((b) => b.id),
    ).toEqual(order);
    const zoned = await drawIR(map, "t", { palette: pal });
    expect(zoned.layout !== null && "lanes" in zoned.layout).toBe(false);
    expect(zoned.layout!.zones.length).toBeGreaterThan(0);
  });

  it("draws a zoned left-to-right flow as lanes when asked", async () => {
    const lr: FlowIR = {
      kind: "flow",
      direction: "LR",
      zones: [
        { id: "p", title: "Requester" },
        { id: "q", title: "Helper" },
      ],
      nodes: [
        { id: "a", label: "Ask", shape: "step", zone: "p" },
        { id: "b", label: "Answer", shape: "step", zone: "q" },
      ],
      edges: [
        { from: "a", to: "b", label: "", dashed: false, head: "end" },
        { from: "b", to: "a", label: "", dashed: false, head: "end" },
      ],
    };
    const { svg, layout } = await drawIR(lr, "t", {
      lanes: true,
      palette: pal,
    });
    expect(svg).toContain(">HELPER</text>");
    expect(layout !== null && "lanes" in layout).toBe(true);
  });

  it("draws a top-down swimlane in bands", async () => {
    const { svg, laid } = await drawIR(
      {
        kind: "swimlane",
        direction: "TB",
        lanes: [
          { id: "p", title: "Requester" },
          { id: "q", title: "Helper" },
        ],
        nodes: [
          { id: "a", label: "Ask", shape: "step", lane: "p" },
          { id: "b", label: "Answer", shape: "step", lane: "q" },
        ],
        edges: [{ from: "a", to: "b", label: "", dashed: false, head: "end" }],
      },
      "t",
      { palette: pal },
    );
    expect(svg).toContain(">REQUESTER</text>");
    const l = laid as { nodes: { id: string; y: number }[] };
    const y = (id: string) => l.nodes.find((n) => n.id === id)!.y;
    expect(y("b")).toBeGreaterThan(y("a"));
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
