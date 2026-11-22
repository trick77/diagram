import { describe, it, expect } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ClassDiagramIR, ClassIR, ClassRelIR } from "./ir";
import { layoutClass, memberLine } from "./class";
import { checkClass } from "./check/check";
import { drawClass } from "./draw";
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

const cls = (
  id: string,
  fields: string[] = [],
  methods: string[] = [],
  over: Partial<ClassIR> = {},
): ClassIR => ({
  id,
  label: id,
  fields: fields.map((text) => ({ text })),
  methods: methods.map((text) => ({ text })),
  ...over,
});
const rel = (
  from: string,
  to: string,
  kind: ClassRelIR["kind"],
  over: Partial<ClassRelIR> = {},
): ClassRelIR => ({
  from,
  to,
  kind,
  dashed: false,
  label: "",
  fromCard: "",
  toCard: "",
  ...over,
});
const diagram = (
  classes: ClassIR[],
  rels: ClassRelIR[],
  direction: "TB" | "LR" = "TB",
): ClassDiagramIR => ({ kind: "class", direction, classes, rels });

const shapes = diagram(
  [
    cls("Shape", [], ["+area() : double", "+name() : String"], {
      stereotype: "interface",
    }),
    cls("Circle", ["-radius double"], ["+area() : double"]),
    cls("Square", ["-side double"], ["+area() : double"], { focus: true }),
    cls("Canvas", ["+title String"], ["+draw()"]),
  ],
  [
    rel("Circle", "Shape", "inheritance", { dashed: true }),
    rel("Square", "Shape", "inheritance", { dashed: true }),
    rel("Canvas", "Shape", "association", {
      label: "draws",
      fromCard: "1",
      toCard: "0..*",
    }),
  ],
);

describe("layoutClass", () => {
  it("sizes a class to its widest line, in three compartments", async () => {
    const l = await layoutClass(shapes, new ELK());
    const shape = l.classes.get("Shape")!;
    expect(shape.stereotype).toBe("«interface»");
    expect(shape.fields).toEqual([]);
    expect(shape.methods.map((m) => m.lines)).toEqual([
      ["+area() : double"],
      ["+name() : String"],
    ]);
    // Name, an empty field compartment, two methods: each as tall as its
    // lines, the empty one a thin band.
    expect(shape.fieldsH).toBeLessThan(memberLine);
    expect(shape.methodsH).toBeGreaterThanOrEqual(2 * memberLine);
    const box = l.nodes.find((n) => n.id === "Shape")!;
    expect(box.h).toBe(shape.head + shape.fieldsH + shape.methodsH);
    expect(checkClass(l)).toEqual([]);
  });

  it("puts a parent above its children and the class using another above it", async () => {
    const l = await layoutClass(shapes, new ELK());
    const at = (id: string) => l.nodes.find((n) => n.id === id)!;
    expect(at("Circle").y).toBeGreaterThan(at("Shape").y + at("Shape").h);
    expect(at("Square").y).toBeGreaterThan(at("Shape").y + at("Shape").h);
    expect(at("Canvas").y).toBeLessThan(at("Shape").y);
  });

  it("marks each relationship at the end its kind names, the multiplicities beside the ends", async () => {
    const l = await layoutClass(shapes, new ELK());
    // Inheritance is laid out parent first: the triangle sits at the
    // route's start, on the parent.
    const inherit = l.edges.findIndex(
      (e) => e.from === "Shape" && e.to === "Circle",
    );
    expect(inherit).toBeGreaterThanOrEqual(0);
    expect(l.ends[inherit].from.mark).toBe("triangle");
    expect(l.ends[inherit].to.mark).toBeNull();
    expect(l.edges[inherit].dashed).toBe(true);
    const uses = l.edges.findIndex((e) => e.from === "Canvas");
    expect(l.ends[uses].to.mark).toBe("arrow");
    expect(l.ends[uses].from.card!.lines).toEqual(["1"]);
    expect(l.ends[uses].to.card!.lines).toEqual(["0..*"]);
    expect(l.edges[uses].label!.lines).toEqual(["draws"]);
  });

  it("draws composition and aggregation as diamonds at the whole", async () => {
    const l = await layoutClass(
      diagram(
        [cls("Order"), cls("Line"), cls("Customer")],
        [
          rel("Line", "Order", "composition", { fromCard: "1..*" }),
          rel("Customer", "Order", "aggregation"),
        ],
      ),
      new ELK(),
    );
    const marks = l.edges.map((e, i) =>
      e.from === "Order" ? l.ends[i].from.mark : l.ends[i].to.mark,
    );
    expect(marks.sort()).toEqual(["diamond", "filledDiamond"]);
    expect(checkClass(l)).toEqual([]);
  });

  it("lays a class diagram out left to right when asked", async () => {
    const l = await layoutClass(
      diagram([cls("A"), cls("B")], [rel("A", "B", "association")], "LR"),
      new ELK(),
    );
    const [a, b] = l.nodes;
    expect(b.x).toBeGreaterThan(a.x + a.w);
  });

  it("wraps a member too long for any box", async () => {
    const long =
      "+reconcile(ledger Ledger, statement Statement, tolerance Money, options ReconcileOptions) Result";
    const l = await layoutClass(
      diagram([cls("Ledger", [], [long])], []),
      new ELK(),
    );
    const box = l.classes.get("Ledger")!;
    expect(box.methods[0].lines.length).toBeGreaterThan(1);
    expect(checkClass(l)).toEqual([]);
  });
});

describe("drawClass", () => {
  it("draws the compartments, the stereotype and the members, escaped", async () => {
    const l = await layoutClass(
      diagram(
        [
          cls("Repo<T>", ["+List<T> items"], ["+find(id) : T"], {
            stereotype: "abstract",
          }),
        ],
        [],
      ),
      new ELK(),
    );
    const svg = drawClass(l, pal);
    expect(svg).toContain("Repo&lt;T&gt;");
    expect(svg).toContain("+List&lt;T&gt; items");
    expect(svg).toContain("«abstract»");
    expect(svg).not.toContain("<T>");
    // Name on the tint, two hairlines between the compartments.
    expect(svg).toContain(`fill="${pal.tint}"`);
    expect(
      svg.match(new RegExp(`<line[^>]*stroke="${pal.line}"`, "g")),
    ).toHaveLength(2);
  });

  it("underlines a static member and sets an abstract one in italics", async () => {
    const l = await layoutClass(
      diagram(
        [
          {
            id: "Clock",
            label: "Clock",
            fields: [{ text: "+int ticks", static: true }],
            methods: [{ text: "+now() : Time", abstract: true }],
          },
        ],
        [],
      ),
      new ELK(),
    );
    const svg = drawClass(l, pal);
    expect(svg).toMatch(/text-decoration="underline"[^>]*>\+int ticks/);
    expect(svg).toMatch(/font-style="italic"[^>]*>\+now\(\) : Time/);
  });

  it("frames the focus in the accent, its hairlines too", async () => {
    const svg = drawClass(await layoutClass(shapes, new ELK()), pal);
    expect(svg).toContain(`stroke="${pal.accent}"`);
    expect(
      svg.match(new RegExp(`<line[^>]*stroke="${pal.accent}"`, "g")),
    ).toHaveLength(2);
  });

  it("draws a hollow triangle, a dashed realization and the multiplicities", async () => {
    const svg = drawClass(await layoutClass(shapes, new ELK()), pal);
    // Two triangles on the surface, one filled arrowhead.
    expect(
      svg.match(new RegExp(`<polygon[^>]*fill="${pal.surface}"`, "g")),
    ).toHaveLength(2);
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain(">0..*</text>");
    expect(svg).toContain(">draws</text>");
  });

  it("fills a composition's diamond and leaves an aggregation's hollow", async () => {
    const svg = drawClass(
      await layoutClass(
        diagram(
          [cls("Order"), cls("Line"), cls("Customer")],
          [
            rel("Line", "Order", "composition"),
            rel("Customer", "Order", "aggregation"),
          ],
        ),
        new ELK(),
      ),
      pal,
    );
    expect(
      svg.match(new RegExp(`<polygon[^>]*fill="${pal.muted}"`, "g")),
    ).toHaveLength(1);
    expect(
      svg.match(new RegExp(`<polygon[^>]*fill="${pal.surface}"`, "g")),
    ).toHaveLength(1);
  });
});
