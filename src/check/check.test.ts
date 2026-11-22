import { describe, it, expect } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import { check, checkClass, checkSwimlane } from "./check";
import type { EdgeRoute, FlowLayout, NodeBox } from "../layout";
import { layoutSwimlane } from "../swimlane";
import { layoutClass } from "../class";

const node = (
  id: string,
  x: number,
  y: number,
  over: Partial<NodeBox> = {},
): NodeBox => ({
  id,
  kind: "step",
  lines: [id],
  face: "sans",
  size: 13,
  bold: false,
  focus: false,
  x,
  y,
  w: 100,
  h: 40,
  ...over,
});
const edge = (
  from: string,
  to: string,
  pts: [number, number][],
  over: Partial<EdgeRoute> = {},
): EdgeRoute => ({
  from,
  to,
  points: pts.map(([x, y]) => ({ x, y })),
  dashed: false,
  warn: false,
  head: "end",
  ...over,
});
const layout = (nodes: NodeBox[], edges: EdgeRoute[]): FlowLayout => ({
  width: 600,
  height: 600,
  nodes,
  edges,
  zones: [],
});

const a = node("a", 0, 0);
const b = node("b", 0, 100);

describe("check", () => {
  it("passes a straight arrow between two boxes", () => {
    expect(
      check(
        layout(
          [a, b],
          [
            edge("a", "b", [
              [50, 40],
              [50, 100],
            ]),
          ],
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a diagonal, and an arrow riding a border", () => {
    expect(
      check(
        layout(
          [a, b],
          [
            edge("a", "b", [
              [50, 40],
              [60, 100],
            ]),
          ],
        ),
      ),
    ).toContain("a->b: diagonal segment");
    expect(
      check(
        layout(
          [a, b],
          [
            edge("a", "b", [
              [50, 40],
              [80, 40],
              [80, 100],
            ]),
          ],
        ),
      ),
    ).toContain("a->b: leaves a along its border");
  });

  it("refuses an arrow behind a box it does not connect", () => {
    const c = node("c", 0, 200);
    const out = check(
      layout(
        [a, b, c],
        [
          edge("a", "c", [
            [50, 40],
            [50, 200],
          ]),
        ],
      ),
    );
    expect(out).toContain("a->c: passes behind b");
  });

  it("refuses a label on its line or over a box", () => {
    const tight = edge(
      "a",
      "b",
      [
        [50, 40],
        [50, 100],
      ],
      { label: { lines: ["x"], x: 52, y: 60, w: 20, h: 15 } },
    );
    expect(check(layout([a, b], [tight]))[0]).toMatch(
      /label 2px from its line/,
    );
    const over = edge(
      "a",
      "b",
      [
        [50, 40],
        [50, 100],
      ],
      { label: { lines: ["x"], x: 60, y: 30, w: 20, h: 15 } },
    );
    expect(check(layout([a, b], [over]))).toContain("a->b: label over a");
  });

  it("refuses two arrows on one stretch or one attach point, and a label too wide for its box", () => {
    const out = check(
      layout(
        [a, b],
        [
          edge("a", "b", [
            [50, 40],
            [50, 100],
          ]),
          edge(
            "a",
            "b",
            [
              [50, 40],
              [50, 100],
            ],
            { head: "none" },
          ),
        ],
      ),
    );
    expect(out).toContain("a->b and a->b: run on top of each other");
    expect(out).toContain("a->b and a->b: share an attach point");
    expect(out).not.toContain("a->b and a->b: cross");
    expect(
      check(
        layout(
          [node("w", 0, 0, { lines: ["a label far too wide for this box"] })],
          [],
        ),
      )[0],
    ).toMatch(/overflows its box/);
  });

  it("refuses two arrows crossing, and passes them side by side", () => {
    const c = node("c", 200, 0);
    const d = node("d", 200, 200);
    const e = node("e", 0, 200);
    const ad = edge("a", "d", [
      [50, 40],
      [50, 120],
      [250, 120],
      [250, 200],
    ]);
    const ce = edge("c", "e", [
      [230, 40],
      [230, 160],
      [70, 160],
      [70, 200],
    ]);
    expect(check(layout([a, c, d, e], [ad, ce]))).toEqual([
      "a->d and c->e: cross",
    ]);
    // A mapping keeps both columns as written: its crossings are its own.
    expect(check(layout([a, c, d, e], [ad, ce]), { written: true })).toEqual(
      [],
    );
    const ae = edge("a", "e", [
      [30, 40],
      [30, 200],
    ]);
    const cd = edge("c", "d", [
      [270, 40],
      [270, 200],
    ]);
    expect(check(layout([a, c, d, e], [ae, cd, ad]))).toEqual([]);
  });
});

describe("checkSwimlane", () => {
  const lanes = () =>
    layoutSwimlane({
      kind: "swimlane",
      lanes: [
        { id: "p", title: "Requester" },
        { id: "q", title: "Approver" },
      ],
      nodes: [
        { id: "a", label: "Ask", shape: "step", lane: "p" },
        { id: "b", label: "Decide", shape: "step", lane: "q" },
      ],
      edges: [{ from: "a", to: "b", label: "", dashed: false, head: "end" }],
    })!;

  it("passes a laid out swimlane", () => {
    expect(checkSwimlane(lanes())).toEqual([]);
  });

  it("finds a step outside its lane, a name past the header, a gap between lanes", () => {
    const l = lanes();
    l.nodes[0].y = l.lanes[1].y + 4;
    l.lanes[0].lines = ["A NAME FAR TOO LONG FOR THE HEADER"];
    l.lanes[1].y += 2;
    expect(checkSwimlane(l)).toEqual(
      expect.arrayContaining([
        "q: not right under p",
        "p: its name overflows the header",
        "a: outside its lane p",
      ]),
    );
  });

  it("finds a name taller than its lane", () => {
    const l = lanes();
    l.lanes[0].lines = Array.from({ length: 9 }, () => "X");
    expect(checkSwimlane(l)).toContain("p: its name is taller than its lane");
  });

  it("finds a label strayed from its arrow, and one another arrow runs through", () => {
    const l = layoutSwimlane({
      kind: "swimlane",
      lanes: [
        { id: "p", title: "Requester" },
        { id: "q", title: "Approver" },
      ],
      nodes: [
        { id: "a", label: "Ask", shape: "step", lane: "p" },
        { id: "b", label: "Wait", shape: "step", lane: "p" },
        { id: "c", label: "Decide", shape: "step", lane: "q" },
      ],
      edges: [
        { from: "a", to: "b", label: "sent", dashed: false, head: "end" },
        { from: "b", to: "c", label: "", dashed: false, head: "end" },
      ],
    })!;
    expect(checkSwimlane(l)).toEqual([]);
    const label = l.edges[0].label!;
    const y = label.y;
    label.y -= 30;
    expect(checkSwimlane(l)).toContain("a->b: label 38px from its line");
    // Off by a fraction, the distance is said in whole pixels.
    label.y -= 0.37;
    expect(checkSwimlane(l)).toContain("a->b: label 38px from its line");
    label.y += 0.37;
    // Back beside its line, but another arrow run through it.
    label.y = y;
    const mid = label.x + label.w / 2;
    l.edges[1].points = [
      { x: mid, y: label.y - 20 },
      { x: mid, y: label.y + label.h + 20 },
    ];
    expect(checkSwimlane(l)).toEqual(
      expect.arrayContaining(["a->b: label under b->c"]),
    );
  });
});

describe("checkClass", () => {
  const classes = () =>
    layoutClass(
      {
        kind: "class",
        direction: "TB",
        classes: [
          {
            id: "Order",
            label: "Order",
            stereotype: "entity",
            fields: [{ text: "+id string" }],
            methods: [],
          },
          { id: "Line", label: "Line", fields: [], methods: [] },
        ],
        rels: [
          {
            from: "Order",
            to: "Line",
            kind: "association",
            dashed: false,
            label: "holds",
            fromCard: "1",
            toCard: "*",
          },
        ],
      },
      new ELK(),
    );

  it("passes a laid out class diagram", async () => {
    expect(checkClass(await classes())).toEqual([]);
  });

  it("finds text past its class and a compartment short for its lines", async () => {
    const l = await classes();
    const c = l.classes.get("Order")!;
    c.name = ["AVeryLongClassNameThatRunsPastItsBox"];
    c.stereotype = "«a stereotype far too long for its box»";
    c.fields = [
      {
        lines: ["+aFieldFarTooLongForItsBoxToHold string"],
        static: false,
        abstract: false,
      },
      { lines: ["+more int"], static: false, abstract: false },
    ];
    c.methodsH = 2;
    expect(checkClass(l)).toEqual(
      expect.arrayContaining([
        "Order: its name overflows its class",
        "Order: its stereotype overflows its class",
        'Order: "+aFieldFarTooLongForItsBoxToHold string" overflows its class',
        "Order: a compartment is short for its lines",
      ]),
    );
  });

  it("finds compartments past the box, a short end and a misplaced multiplicity", async () => {
    const l = await classes();
    const c = l.classes.get("Line")!;
    c.head += 40;
    const e = l.edges[0];
    const card = l.ends[0].from.card!;
    const order = l.nodes.find((n) => n.id === "Order")!;
    card.x = order.x + 4;
    card.y = order.y + 4;
    e.points = [e.points[0], { x: e.points[0].x, y: e.points[0].y + 10 }];
    const out = checkClass(l);
    expect(out).toContain("Line: its compartments run past its box");
    expect(out).toContain("Order->Line: an end too short for its mark");
    expect(out).toContain("Order->Line at Order: multiplicity over Order");
  });
});
