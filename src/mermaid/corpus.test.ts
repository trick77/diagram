import { describe, it, expect, beforeAll } from "vitest";
import mermaid from "mermaid";
import ELK from "elkjs/lib/elk.bundled.js";
import { diagramKind } from "./kind";
import { ownKinds } from "./draw";
import { escapeAngles, repair } from "./text";
import { toIR } from "./ir";
import { editorial } from "./editorial";
import { fits } from "../fits";
import type { DiagramIR, MindNodeIR } from "../ir";
import { layoutFlow, layoutSpine } from "../layout";
import { asFlow, layoutSwimlane } from "../swimlane";
import { layoutBands } from "../bands";
import { checkIR } from "../check/ir";
import { checkSwimlane } from "../check/check";
import { layoutTimeline } from "../timeline";

/**
 * The diagram corpus (testdata/diagrams): sources in the shapes models have
 * written, run through everything a consumer's drawing does. The renderer's
 * parser is the real one, not a mock: parse runs without a DOM, and whether
 * it accepts the source is exactly the question. Drawing the renderer's
 * pictures needs a browser and is checked there.
 *
 * A diagram that fails to draw belongs here as a new .mmd first, and the
 * fix afterwards. Each consumer runs its own corpus the same way, through
 * ./check.
 */

const sources: Record<string, string> = import.meta.glob(
  "../../testdata/diagrams/*.mmd",
  { query: "?raw", import: "default", eager: true },
);

const corpus = Object.entries(sources).map(([path, text]) => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  stored: text.trimEnd(),
  // As draw() reads it: the shapes it repairs repaired.
  src: repair(text.trimEnd()),
}));

/** Sources the renderer refuses even repaired: a mark on an edge label,
 * `H -->|"Yes":::focus --> I`, says nothing a repair could know. Asserted
 * refused, so a repair that learns it flips the test. */
const refused = new Set(["flow-focus-on-edge-en.mmd"]);

/** Sources within the caps the package lays out against its own rules
 * (edges crossing, a line behind a box) with every layout it has: the
 * renderer draws them instead (editorial.ts). Asserted broken, so a layout
 * that learns them flips the test. */
const broken = new Set([
  "state-dense-de.mmd",
  "state-dense-en.mmd",
  "flow-focus-spaced-de.mmd",
]);

/** Sources of a kind the package draws that are past its limits on
 * purpose: the renderer draws them, and the corpus says so per file. */
const declined = new Set([
  "mindmap-too-big.mmd",
  "quadrant-many-fallback.mmd",
  "class-too-big.mmd",
  "class-code-past-caps.mmd",
  "swimlane-too-big.mmd",
  "swimlane-down-system-map.mmd",
]);

/** The flowcharts that are trees the org chart draws. */
const orgCharts = new Set(["tree-org-chart.mmd", "tree-four-levels.mmd"]);

/** The flowcharts read as swimlanes: every step in one of two or more
 * subgraphs, no mapping; top-down, with an arrow handed from one to
 * another (drawn in bands). */
const swimlanes = new Set([
  "swimlane-loop.mmd",
  "swimlane-two-lanes.mmd",
  "swimlane-skip.mmd",
  "swimlane-join.mmd",
  "swimlane-too-big.mmd",
  "swimlane-five-services.mmd",
  "swimlane-down-process.mmd",
  "swimlane-down-repo-map.mmd",
  "swimlane-down-system-map.mmd",
]);

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
});

/** mind is every node of a mindmap, topic first. */
const mind = (n: MindNodeIR): MindNodeIR[] => [n, ...n.children.flatMap(mind)];

async function irOf(src: string): Promise<DiagramIR | null> {
  const d = await mermaid.mermaidAPI.getDiagramFromText(escapeAngles(src));
  return toIR(d.type, d.db);
}

/** labels is every text an IR draws, for the bracket count. */
function labels(ir: DiagramIR): string[] {
  if (ir.kind === "sequence")
    return [
      ...ir.actors.map((a) => a.label),
      ...ir.rows.map((r) => ("label" in r ? r.label : "")),
    ];
  if (ir.kind === "er")
    return [
      ...ir.entities.flatMap((e) => [
        e.label,
        ...e.attrs.flatMap((a) => [a.type, a.name, a.comment]),
      ]),
      ...ir.rels.map((r) => r.label),
    ];
  if (ir.kind === "mindmap") return mind(ir.root).map((n) => n.label);
  if (ir.kind === "timeline")
    return [
      ir.title,
      ...ir.periods.flatMap((p) => [p.label, p.section ?? "", ...p.events]),
    ];
  if (ir.kind === "quadrant")
    return [
      ir.title,
      ir.xAxis,
      ir.yAxis,
      ...ir.quadrants,
      ...ir.points.map((p) => p.label),
    ];
  if (ir.kind === "class")
    return [
      ...ir.classes.flatMap((c) => [
        c.label,
        c.stereotype ?? "",
        ...[...c.fields, ...c.methods].map((m) => m.text),
      ]),
      ...ir.rels.flatMap((r) => [r.label, r.fromCard, r.toCard]),
    ];
  return [
    ...ir.nodes.map((n) => n.label),
    ...ir.edges.map((e) => e.label),
    ...(ir.kind === "swimlane" ? ir.lanes : ir.zones).map((z) => z.title),
  ];
}

/** generics counts the angle brackets a class diagram's `~T~` becomes: a
 * tilde in a class's declaration or body is drawn as one. One in a
 * relationship's class name, `Repo~T~ <|-- Store`, only names the class. */
function generics(src: string): number {
  if (!diagramKind(src).startsWith("classDiagram")) return 0;
  let inClass = false;
  let n = 0;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (inClass) {
      if (t.startsWith("}")) inClass = false;
      else n += (t.match(/~/g) ?? []).length;
    } else if (/^class\s/.test(t)) {
      n += (t.match(/~/g) ?? []).length;
      inClass = t.endsWith("{");
    }
  }
  return n;
}

describe("the diagram corpus", () => {
  it("covers every kind the package draws, and one it hands on", () => {
    const kinds = new Set(corpus.map((c) => diagramKind(c.src)));
    for (const k of ownKinds) expect(kinds, k).toContain(k);
    expect([...kinds].some((k) => !ownKinds.has(k))).toBe(true);
  });

  for (const { name, stored, src } of corpus) {
    if (refused.has(name)) {
      it(`is refused, repaired or not: ${name}`, async () => {
        expect(await mermaid.parse(src, { suppressErrors: true })).toBe(false);
      });
      continue;
    }

    it(`parses ${name}`, async () => {
      // The source as stored parses, or what stands in its way is a shape
      // draw() repairs (repair: a stray or misplaced mark, a keyword).
      if (!(await mermaid.parse(stored, { suppressErrors: true })))
        expect(src, `the renderer refuses:\n${stored}`).not.toBe(stored);
      expect(
        await mermaid.parse(src, { suppressErrors: true }),
        `the renderer refuses:\n${src}`,
      ).toBeTruthy();
      // draw() parses the source with its brackets kept as text; one it
      // cannot parse falls back and loses them, which must show here.
      const escaped = escapeAngles(src);
      expect(
        await mermaid.parse(escaped, { suppressErrors: true }),
        `the escaped source is refused:\n${escaped}`,
      ).toBeTruthy();
    });

    // Which drawing each source gets: the package's own for the kinds it
    // draws, the renderer's for the rest. Asserted per source, so a diagram
    // that quietly falls back to the renderer fails here rather than
    // looking like it always did.
    it(`draws ${name} with the drawing its kind gets`, async () => {
      const svg = await editorial(mermaid, escapeAngles(src), "corpus");
      if (
        ownKinds.has(diagramKind(src)) &&
        !declined.has(name) &&
        !broken.has(name)
      ) {
        expect(svg, "the package declined a kind it draws").toMatch(/^<svg /);
      } else {
        expect(svg, "the package drew what the renderer should").toBeNull();
      }
    });

    it(`keeps every angle bracket ${name}'s labels hold`, async () => {
      if (!ownKinds.has(diagramKind(src))) return;
      // Every bracket the escape turned into text reaches a drawn label, and
      // nothing of the escaping is left in one. Tooltips, links and styles
      // are escaped too but never drawn as a label.
      const labelled = escapeAngles(src)
        .split("\n")
        .filter((l) => !/^\s*(click|classDef|class|style|linkStyle)\b/.test(l))
        .join("\n");
      const kept = (labelled.match(/#lt;|#gt;/g) ?? []).length;
      const ir = await irOf(src);
      if (ir === null) return;
      const drawn = labels(ir).join("");
      expect((drawn.match(/[<>]/g) ?? []).length).toBe(kept + generics(src));
      expect(drawn).not.toMatch(/#lt;|#gt;|ﬂ°|¶ß/);
    });

    it(`lays out ${name} by the connector rules`, async () => {
      const ir = await irOf(src);
      if (ir === null || !fits(ir)) return;
      // A swimlane is drawn in lanes, never handed to the flow layout for
      // want of a route.
      if (ir.kind === "swimlane") {
        const lanes =
          ir.direction === "TB"
            ? await layoutBands(asFlow(ir), new ELK())
            : layoutSwimlane(ir);
        expect(lanes, "the lanes declined it").not.toBeNull();
        // And kept by the rules: lanes they refuse give way to the zoned
        // flow (drawIR), and no swimlane drawn in lanes before the label
        // rules may lose them to it.
        expect(checkSwimlane(lanes!), "its lanes break a rule").toEqual([]);
      }
      if (broken.has(name))
        expect(
          await checkIR(ir),
          "a known break now lays out clean",
        ).not.toEqual([]);
      else expect(await checkIR(ir)).toEqual([]);
    });

    it(`frames every node ${name} marks :::focus, and no other`, async () => {
      if (diagramKind(src) !== "flowchart" && diagramKind(src) !== "graph")
        return;
      const ir = await irOf(src);
      if (ir === null || (ir.kind !== "flow" && ir.kind !== "swimlane")) return;
      // A node marked where it is declared, `c["…"]:::focus`, by its id.
      const marked = new Set(
        [
          ...src.matchAll(
            /(\w+)\s*(?:\[[^\]]*\]|\{[^}]*\}|\([^)]*\))?:::focus\b/g,
          ),
        ].map((m) => m[1]),
      );
      expect(
        ir.nodes
          .filter((n) => n.focus)
          .map((n) => n.id)
          .sort(),
      ).toEqual([...marked].sort());
    });

    // Which flowcharts are drawn as an org chart: the trees, and no other.
    // Asserted per source, so a flowchart the org chart takes from the
    // spine or the engine shows here rather than as a different picture.
    it(`draws ${name} as an org chart only if it is one`, async () => {
      if (diagramKind(src) !== "flowchart" && diagramKind(src) !== "graph")
        return;
      const ir = await irOf(src);
      if (ir === null || ir.kind !== "flow") return;
      const l = await layoutFlow(ir, async () => new ELK());
      expect(l.bus === true, "drawn as an org chart").toBe(orgCharts.has(name));
      // Nearly a tree, but two branches meet again: the engine's, as before.
      if (name === "tree-not-a-tree.mmd") expect(layoutSpine(ir)).toBeNull();
    });

    it(`marks every node ${name} tags :::focus on its next line, and no other`, async () => {
      if (diagramKind(stored) !== "mindmap") return;
      const ir = await irOf(stored);
      if (ir === null || ir.kind !== "mindmap") return;
      // The mark tags the node on the line above it: that line's text, out
      // of its id, shape and quotes (`id["…"]`, the form loom asks for).
      const lines = stored.split("\n");
      const marked = lines.flatMap((l, i) =>
        /^\s*:::.*\bfocus\b/.test(l)
          ? [
              lines[i - 1]
                .trim()
                .replace(/^[\w-]*(\(\(|\(|\[|\{\{)(.*)(\)\)|\)|\]|\}\})$/, "$2")
                .replace(/^"(.*)"$/, "$1"),
            ]
          : [],
      );
      if (stored.includes(":::focus")) expect(marked).not.toEqual([]);
      expect(
        mind(ir.root)
          .filter((n) => n.focus)
          .map((n) => n.label)
          .sort(),
      ).toEqual(marked.sort());
    });

    it(`marks every point ${name} marks :::focus, and no other`, async () => {
      if (diagramKind(src) !== "quadrantChart") return;
      const ir = await irOf(src);
      if (ir === null || ir.kind !== "quadrant") return;
      // A point written `Label:::focus: [x, y]`.
      const marked = [...src.matchAll(/^\s*(.+?):::focus\s*:/gm)].map((m) =>
        m[1].trim(),
      );
      expect(ir.points.filter((p) => p.focus).map((p) => p.label)).toEqual(
        marked,
      );
    });

    // Lanes are read only where the source is one; every other flowchart
    // keeps the layout it had.
    it(`reads ${name} as lanes only if it is a swimlane`, async () => {
      if (diagramKind(src) !== "flowchart" && diagramKind(src) !== "graph")
        return;
      const ir = await irOf(src);
      if (ir === null) return;
      expect(ir.kind === "swimlane", "read as lanes").toBe(swimlanes.has(name));
    });

    it(`frames every class ${name} marks focus, and no other`, async () => {
      if (!diagramKind(src).startsWith("classDiagram")) return;
      const ir = await irOf(src);
      if (ir === null || ir.kind !== "class") return;
      // `class Order:::focus` or `cssClass "Order" focus`.
      const marked = new Set([
        ...[...src.matchAll(/class\s+(\w+)(?:~[^~]*~)?:::focus\b/g)].map(
          (m) => m[1],
        ),
        ...[...src.matchAll(/cssClass\s+"([^"]+)"\s+focus\b/g)].flatMap((m) =>
          m[1].split(",").map((s) => s.trim()),
        ),
      ]);
      expect(
        ir.classes
          .filter((c) => c.focus)
          .map((c) => c.id)
          .sort(),
      ).toEqual([...marked].sort());
    });
  }
});

describe("the corpus's timelines", () => {
  const ir = async (file: string) => {
    const c = corpus.find((c) => c.name === file);
    expect(c, file).toBeDefined();
    const out = await irOf(c!.src);
    if (out?.kind !== "timeline") throw new Error(`${file}: no timeline`);
    return out;
  };

  it("lie flat in a 720px text column with five short periods", async () => {
    expect(layoutTimeline(await ir("timeline-five.mmd"), 720).orient).toBe(
      "horizontal",
    );
  });

  it("stand up in a 700px column when they hold more", async () => {
    const nine = await ir("timeline-nine.mmd");
    expect(nine.periods).toHaveLength(9);
    expect(layoutTimeline(nine, 700).orient).toBe("vertical");
  });
});
