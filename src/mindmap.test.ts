import { describe, it, expect } from "vitest";
import type { MindNodeIR, MindmapIR } from "./ir";
import { layoutMindmap, split, type MindmapLayout } from "./mindmap";
import { drawMindmap } from "./draw";
import { drawIR } from "./render";
import { checkMindmap } from "./check/check";
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

const node = (
  label: string,
  children: MindNodeIR[] = [],
  focus = false,
): MindNodeIR => ({ label, children, ...(focus ? { focus } : {}) });
const map = (root: MindNodeIR): MindmapIR => ({ kind: "mindmap", root });

/** Eight branches of two leaves each: the shape the mindmap was made for. */
const eight = map(
  node(
    "Project kickoff",
    [
      "Goals",
      "Budget",
      "Team setup",
      "Schedule",
      "Risks",
      "Tools",
      "Reviews",
      "Launch",
    ].map((b, i) =>
      node(b, [node(`${b} first`), node(`${b} ${i * 10} %`)], i === 2),
    ),
  ),
);

const at = (l: MindmapLayout, id: string) => l.nodes.find((n) => n.id === id)!;
const mid = (l: MindmapLayout, id: string) => {
  const n = at(l, id);
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
};

describe("layoutMindmap", () => {
  it("puts the topic in the middle and the branches around it clockwise", () => {
    const l = layoutMindmap(eight);
    const root = mid(l, "root");
    const right = ["1", "2", "3", "4"];
    const left = ["5", "6", "7", "8"];
    for (const id of right) expect(at(l, id).x).toBeGreaterThan(root.x);
    for (const id of left)
      expect(at(l, id).x + at(l, id).w).toBeLessThan(root.x);
    // Down the right side, then up the left.
    const ys = (ids: string[]) => ids.map((id) => mid(l, id).y);
    expect(ys(right)).toEqual([...ys(right)].sort((a, b) => a - b));
    expect(ys(left)).toEqual([...ys(left)].sort((a, b) => b - a));
    // The topic sits level with the middle of both sides.
    const span = (ids: string[]) => {
      const v = ys(ids);
      return (Math.min(...v) + Math.max(...v)) / 2;
    };
    expect(span(right)).toBeCloseTo(root.y, 0);
    expect(span(left)).toBeCloseTo(root.y, 0);
  });

  it("balances the sides by how tall their branches stand", () => {
    expect(split([])).toBe(0);
    expect(split([30])).toBe(1);
    expect(split([30, 30, 30, 30])).toBe(2);
    // A tall first branch stands alone on its side, a tie goes right.
    expect(split([200, 30, 30, 30])).toBe(1);
    expect(split([30, 30, 30])).toBe(2);
    const l = layoutMindmap(
      map(
        node("Plan", [
          node("Many", [node("a"), node("b"), node("c"), node("d")]),
          node("One", [node("e")]),
          node("Two", [node("f")]),
          node("Three", [node("g")]),
        ]),
      ),
    );
    const root = mid(l, "root");
    expect(mid(l, "1").x).toBeGreaterThan(root.x);
    expect(mid(l, "2").x).toBeLessThan(root.x);
  });

  it("stacks a branch's leaves beside it, reading away from the topic", () => {
    const l = layoutMindmap(eight);
    for (const b of ["1", "8"]) {
      const br = at(l, b);
      const leaves = [at(l, `${b}.1`), at(l, `${b}.2`)];
      expect(leaves[0].y + leaves[0].h).toBeLessThanOrEqual(leaves[1].y);
      // Centred on the branch, both starting at one column.
      const c = (leaves[0].y + leaves[1].y + leaves[1].h) / 2;
      expect(c).toBeCloseTo(br.y + br.h / 2, 0);
      if (br.side === 1) {
        expect(leaves[0].x).toBe(leaves[1].x);
        expect(leaves[0].x).toBeGreaterThan(br.x + br.w);
      } else {
        expect(leaves[0].x + leaves[0].w).toBe(leaves[1].x + leaves[1].w);
        expect(leaves[0].x + leaves[0].w).toBeLessThan(br.x);
      }
    }
  });

  it("hangs a leaf's children under it, one step further out", () => {
    const l = layoutMindmap(
      map(
        node("Plan", [
          node("Scope", [node("Goals", [node("Short"), node("Long")])]),
          node("Risks", [node("Delays", [node("Supply")])]),
        ]),
      ),
    );
    const goals = at(l, "1.1");
    const [short, long] = [at(l, "1.1.1"), at(l, "1.1.2")];
    expect(short.y).toBeGreaterThan(goals.y + goals.h);
    expect(long.y).toBeGreaterThan(short.y + short.h);
    expect(short.x).toBe(goals.x + 16);
    // On the left side the step goes left.
    const delays = at(l, "2.1");
    const supply = at(l, "2.1.1");
    expect(supply.x + supply.w).toBe(delays.x + delays.w - 16);
    expect(checkMindmap(l)).toEqual([]);
  });

  it("joins every node to its parent with a curve from the side facing it", () => {
    const l = layoutMindmap(eight);
    expect(l.links).toHaveLength(8 + 16);
    const root = at(l, "root");
    const toRight = l.links.find((k) => k.to === "1")!;
    expect(toRight.points[0]).toEqual({
      x: root.x + root.w,
      y: mid(l, "root").y,
    });
    expect(toRight.points[3].x).toBe(at(l, "1").x);
    const toLeft = l.links.find((k) => k.to === "8")!;
    expect(toLeft.points[0].x).toBe(root.x);
    expect(toLeft.points[3].x).toBe(at(l, "8").x + at(l, "8").w);
    // The marked branch's curve carries its mark, and only its.
    expect(l.links.filter((k) => k.focus).map((k) => k.to)).toEqual(["3"]);
  });

  it("wraps a long label and sizes its pill to it", () => {
    const l = layoutMindmap(
      map(
        node("A topic long enough that it has to wrap onto lines of its own", [
          node("A branch that is also rather long for a single pill"),
        ]),
      ),
    );
    expect(at(l, "root").lines.length).toBeGreaterThan(1);
    expect(at(l, "1").lines.length).toBeGreaterThan(1);
    expect(checkMindmap(l)).toEqual([]);
  });

  it("sets a name from the code in the mono", () => {
    const l = layoutMindmap(map(node("Plan", [node("parseConfig()")])));
    expect(at(l, "1").face).toBe("mono");
    expect(at(l, "1").bold).toBe(false);
  });

  it("draws a topic alone", () => {
    const l = layoutMindmap(map(node("Plan")));
    expect(l.nodes).toHaveLength(1);
    expect(l.links).toEqual([]);
    expect(at(l, "root").x).toBe(24);
  });

  it("passes its own check, eight branches of two leaves", () => {
    expect(checkMindmap(layoutMindmap(eight))).toEqual([]);
  });

  it("passes its own check at its caps, every label wrapping", () => {
    const long = (s: string) => `${s} with a label long enough to wrap`;
    const full = map(
      node(
        long("Topic"),
        Array.from({ length: 8 }, (_, b) =>
          node(
            long(`Branch ${b}`),
            Array.from({ length: 4 }, (_, l) =>
              node(
                long(`Leaf ${b}.${l}`),
                Array.from({ length: 4 }, (_, s) =>
                  node(long(`Note ${b}.${l}.${s}`)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    const l = layoutMindmap(full);
    expect(l.nodes).toHaveLength(1 + 8 + 32 + 128);
    expect(checkMindmap(l)).toEqual([]);
  });
});

const parse = (svg: string) =>
  new DOMParser().parseFromString(svg, "image/svg+xml");

describe("drawMindmap", () => {
  it("draws curves, pills for the topic and branches and bare text for leaves", () => {
    const doc = parse(drawMindmap(layoutMindmap(eight), pal));
    expect(doc.querySelector("parsererror")).toBeNull();
    const paths = [...doc.querySelectorAll("path")];
    expect(paths).toHaveLength(24);
    for (const p of paths) expect(p.getAttribute("d")).toMatch(/^M[\d.,]+ C/);
    // The canvas, the topic and eight branches: no frame round a leaf.
    expect(doc.querySelectorAll("rect")).toHaveLength(1 + 1 + 8);
    const texts = [...doc.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("Project kickoff");
    expect(texts).toContain("Team setup 20 %");
  });

  it("marks the focus in the accent: the pill's frame and fill, its curve", () => {
    const doc = parse(drawMindmap(layoutMindmap(eight), pal));
    const pill = [...doc.querySelectorAll("rect")].find(
      (r) => r.getAttribute("stroke") === pal.accent,
    )!;
    expect(pill.getAttribute("fill")).toBe(pal.accent);
    expect(pill.getAttribute("fill-opacity")).toBe("0.12");
    // Its text stays the text colour: the frame carries the mark.
    expect(
      [...doc.querySelectorAll("text")]
        .find((t) => t.textContent === "Team setup")!
        .getAttribute("fill"),
    ).toBe(pal.fg);
    const accent = [...doc.querySelectorAll("path")].filter(
      (p) => p.getAttribute("stroke") === pal.accent,
    );
    expect(accent).toHaveLength(1);
    // The other branches carry no frame at all; the topic its line.
    const frames = [...doc.querySelectorAll("rect")]
      .slice(1)
      .map((r) => r.getAttribute("stroke"));
    expect(frames.filter((s) => s === pal.line)).toHaveLength(1);
    expect(frames.filter((s) => s === null)).toHaveLength(7);
  });

  it("marks a leaf in the accent text, and sets a leaf's children muted", () => {
    const doc = parse(
      drawMindmap(
        layoutMindmap(
          map(
            node("Plan", [
              node("Scope", [node("Goals", [node("Short")], true)]),
              node("Risks", [node("Delays", [node("Supply")])]),
            ]),
          ),
        ),
        pal,
      ),
    );
    const fill = (s: string) =>
      [...doc.querySelectorAll("text")]
        .find((t) => t.textContent === s)!
        .getAttribute("fill");
    expect(fill("Goals")).toBe(pal.accent);
    expect(fill("Short")).toBe(pal.muted);
    expect(fill("Delays")).toBe(pal.fg);
    const anchor = (s: string) =>
      [...doc.querySelectorAll("text")]
        .find((t) => t.textContent === s)!
        .getAttribute("text-anchor");
    expect(anchor("Goals")).toBe("start");
    expect(anchor("Delays")).toBe("end");
    expect(anchor("Plan")).toBe("middle");
  });

  it("frames a marked topic in the accent", () => {
    const doc = parse(
      drawMindmap(layoutMindmap(map(node("Plan", [], true))), pal),
    );
    expect(doc.querySelectorAll("rect")[1].getAttribute("stroke")).toBe(
      pal.accent,
    );
  });

  it("writes every label as text, whatever it holds", () => {
    const svg = drawMindmap(layoutMindmap(map(node(`<b>"x" & y</b>`))), pal);
    expect(svg).not.toContain("<b>");
    expect(parse(svg).querySelector("text")!.textContent).toBe(
      `<b>"x" & y</b>`,
    );
  });

  it("is what drawIR draws for a mindmap", async () => {
    const { svg, layout } = await drawIR(eight, "t", { palette: pal });
    expect(layout).toBeNull();
    expect(svg).toBe(drawMindmap(layoutMindmap(eight), pal));
  });
});
