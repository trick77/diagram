import { describe, it, expect } from "vitest";
import { checkMindmap } from "./check";
import type { MindBox, MindLink, MindmapLayout } from "../mindmap";
import type { Point } from "../layout";

const box = (
  id: string,
  x: number,
  y: number,
  over: Partial<MindBox> = {},
): MindBox => ({
  id,
  level: 1,
  side: 1,
  lines: [id],
  face: "sans",
  size: 13,
  bold: false,
  focus: false,
  padX: 0,
  x,
  y,
  w: 60,
  h: 30,
  ...over,
});
const p = (x: number, y: number): Point => ({ x, y });
const link = (
  from: string,
  to: string,
  a: Point,
  b: Point,
  over: Partial<MindLink> = {},
): MindLink => {
  const mx = (a.x + b.x) / 2;
  return {
    from,
    to,
    level: 1,
    points: [a, p(mx, a.y), p(mx, b.y), b],
    focus: false,
    ...over,
  };
};
const layout = (nodes: MindBox[], links: MindLink[]): MindmapLayout => ({
  width: 600,
  height: 400,
  nodes,
  links,
});

// A topic with two branches to its right, one above the other.
const root = box("root", 20, 185, { level: 0, side: 0 });
const up = box("1", 200, 100);
const down = box("2", 200, 300);
const fan = [
  link("root", "1", p(80, 200), p(200, 115)),
  link("root", "2", p(80, 200), p(200, 315)),
];

describe("checkMindmap", () => {
  it("passes curves fanning out of one point to boxes apart", () => {
    expect(checkMindmap(layout([root, up, down], fan))).toEqual([]);
  });

  it("finds a label wider than its box", () => {
    const wide = box("1", 200, 100, { lines: ["a label far too long"] });
    expect(checkMindmap(layout([root, wide, down], fan))).toEqual([
      `1: "a label far too long" overflows its box`,
    ]);
  });

  it("finds a pill whose padding the text runs into", () => {
    const tight = box("1", 200, 100, { lines: ["Goals"], padX: 14, w: 50 });
    expect(checkMindmap(layout([root, tight, down], fan))).toEqual([
      `1: "Goals" overflows its box`,
    ]);
  });

  it("finds two boxes on one another", () => {
    const onUp = box("3", 230, 110);
    expect(checkMindmap(layout([root, up, down, onUp], fan))).toEqual([
      "1 and 3: overlap",
    ]);
  });

  it("finds a curve behind a box it does not connect", () => {
    const inWay = box("3", 120, 130, { w: 40, h: 20 });
    expect(checkMindmap(layout([root, up, down, inWay], fan))).toEqual([
      "root->1: passes behind 3",
    ]);
  });

  it("finds two curves crossing", () => {
    // The upper branch reached from below the lower one's start, and the
    // other way round.
    const crossed = [
      link("root", "1", p(80, 260), p(200, 115)),
      link("root", "2", p(80, 140), p(200, 315)),
    ];
    expect(checkMindmap(layout([root, up, down], crossed))).toEqual([
      "root->1 and root->2: cross",
    ]);
  });

  it("finds a box past the canvas", () => {
    const out = box("2", 560, 300);
    expect(
      checkMindmap(
        layout(
          [root, up, out],
          [fan[0], link("root", "2", p(80, 200), p(560, 315))],
        ),
      ),
    ).toEqual(["2: runs past the canvas"]);
  });
});
