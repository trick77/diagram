import { describe, it, expect } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import type { FlowEdgeIR, FlowIR, FlowNodeIR } from "./ir";
import { isTree, layoutTree } from "./tree";
import { layoutFlow, type FlowLayout, type NodeBox } from "./layout";
import { check } from "./check/check";

const n = (
  id: string,
  label = id,
  shape: FlowNodeIR["shape"] = "step",
): FlowNodeIR => ({ id, label, shape });
const e = (
  from: string,
  to: string,
  label = "",
  dashed = false,
): FlowEdgeIR => ({
  from,
  to,
  label,
  dashed,
  head: "end",
});
/** tree is a flow from `parent>child` pairs, its nodes in the order they
 * first appear. */
const tree = (pairs: string, extra: Partial<FlowIR> = {}): FlowIR => {
  const edges = pairs.split(" ").map((p) => p.split(">"));
  const ids = [...new Set(edges.flat())];
  return {
    kind: "flow",
    direction: "TB",
    nodes: ids.map((id) => n(id, `Team ${id}`)),
    edges: edges.map(([a, b]) => e(a, b)),
    zones: [],
    ...extra,
  };
};
const box = (l: FlowLayout, id: string) => l.nodes.find((b) => b.id === id)!;
const cx = (b: NodeBox) => b.x + b.w / 2;
const apart = (l: FlowLayout) =>
  l.nodes.every((a, i) =>
    l.nodes
      .slice(i + 1)
      .every(
        (b) =>
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y,
      ),
  );

const org = tree("a>b a>c a>d b>e b>f d>g d>h d>i");

describe("isTree", () => {
  it("takes a top-down flow where every node has one parent and one fans out", () => {
    expect(isTree(org)).toBe(true);
    expect(isTree(tree("a>b a>c"))).toBe(true);
  });

  it("leaves a chain to the spine, which draws a path", () => {
    expect(isTree(tree("a>b b>c c>d"))).toBe(false);
  });

  it("declines what is not a tree", () => {
    // Two parents, two roots, a cycle beside the root, a loop on a node.
    expect(isTree(tree("a>b a>c b>d c>d"))).toBe(false);
    expect(isTree(tree("a>c b>c c>d"))).toBe(false);
    const cycle = tree("a>b a>c d>e e>d");
    expect(cycle.edges.length).toBe(cycle.nodes.length - 1);
    expect(isTree(cycle)).toBe(false);
    expect(isTree(tree("a>b a>c c>c"))).toBe(false);
  });

  it("declines a tree drawn some other way: across, in zones, labelled, dotted, with a decision", () => {
    expect(isTree(tree("a>b a>c", { direction: "LR" }))).toBe(false);
    expect(isTree(tree("a>b a>c", { zones: [{ id: "z", title: "Z" }] }))).toBe(
      false,
    );
    const labelled = tree("a>b a>c");
    labelled.edges[0].label = "yes";
    expect(isTree(labelled)).toBe(false);
    const dotted = tree("a>b a>c");
    dotted.edges[1].dashed = true;
    expect(isTree(dotted)).toBe(false);
    const decision = tree("a>b a>c");
    decision.nodes[0].shape = "decision";
    expect(isTree(decision)).toBe(false);
  });

  it("holds an org chart to four levels and five children", () => {
    expect(isTree(tree("a>b a>c b>d d>e"))).toBe(true);
    expect(isTree(tree("a>b a>c b>d d>e e>f"))).toBe(false);
    expect(isTree(tree("a>b a>c a>d a>e a>f"))).toBe(true);
    expect(isTree(tree("a>b a>c a>d a>e a>f a>g"))).toBe(false);
  });
});

describe("layoutTree's room", () => {
  it("leaves 32 between neighbouring subtrees and from the bus to a child", () => {
    const l = layoutTree(tree("a>b a>c"))!;
    const [b, c] = [box(l, "b"), box(l, "c")];
    expect(c.x - (b.x + b.w)).toBe(32);
    const a = box(l, "a");
    expect(b.y - (a.y + a.h)).toBe(28 + 32);
  });
});

describe("layoutTree", () => {
  it("declines a flow that is not a tree", () => {
    expect(layoutTree(tree("a>b b>c"))).toBeNull();
  });

  it("puts the root on top and its children in a row under it, in the order written", () => {
    const l = layoutTree(org)!;
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => box(l, id));
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(c.y).toBe(b.y);
    expect(d.y).toBe(b.y);
    expect(cx(b)).toBeLessThan(cx(c));
    expect(cx(c)).toBeLessThan(cx(d));
    // A parent over the middle of its first and last child.
    expect(cx(a)).toBe(Math.round((cx(b) + cx(d)) / 2));
    expect(cx(b)).toBe(Math.round((cx(box(l, "e")) + cx(box(l, "f"))) / 2));
    expect(apart(l)).toBe(true);
    expect(l.bus).toBe(true);
  });

  it("joins a parent to its children by a bus: drop, along the row, drop", () => {
    const l = layoutTree(org)!;
    const a = box(l, "a");
    const routes = l.edges.filter((r) => r.from === "a");
    const bus = routes[0].points[1].y;
    for (const r of routes) {
      const to = box(l, r.to);
      expect(r.points[0]).toEqual({ x: cx(a), y: a.y + a.h });
      expect(r.points[r.points.length - 1]).toEqual({ x: cx(to), y: to.y });
      if (r.points.length === 4) {
        expect(r.points[1]).toEqual({ x: cx(a), y: bus });
        expect(r.points[2]).toEqual({ x: cx(to), y: bus });
      }
    }
    expect(bus).toBeGreaterThan(a.y + a.h);
    expect(bus).toBeLessThan(box(l, "b").y);
    // A child right under its parent is one straight drop.
    const straight = l.edges.find((r) => r.from === "d" && r.to === "h")!;
    expect(straight.points).toHaveLength(2);
  });

  it("lands every point on a whole pixel, so every drop is exactly vertical", () => {
    const l = layoutTree(tree("a>b a>c a>d c>e c>f c>g"))!;
    for (const r of l.edges)
      for (const p of r.points) {
        expect(Number.isInteger(p.x)).toBe(true);
        expect(Number.isInteger(p.y)).toBe(true);
      }
    expect(check(l)).toEqual([]);
  });

  it("gives a wide subtree its room, its parent still centred over it", () => {
    const l = layoutTree(tree("a>b a>c c>d c>e c>f c>g c>h"))!;
    expect(apart(l)).toBe(true);
    const c = box(l, "c");
    expect(cx(c)).toBe(Math.round((cx(box(l, "d")) + cx(box(l, "h"))) / 2));
    expect(check(l)).toEqual([]);
  });

  it("shares one width, wraps a long label, and keeps a row's tops level", () => {
    const ir = tree("a>b a>c");
    ir.nodes[1].label =
      "A team name long enough that it has to wrap onto two lines";
    const l = layoutTree(ir)!;
    const [a, b, c] = ["a", "b", "c"].map((id) => box(l, id));
    expect(a.w).toBe(b.w);
    expect(b.lines.length).toBeGreaterThan(1);
    expect(b.h).toBeGreaterThan(c.h);
    expect(b.y).toBe(c.y);
    expect(check(l)).toEqual([]);
  });

  it("lays out a tree at its caps, five children four levels down, by the rules", () => {
    // Sixteen nodes, a flow's most: five under the root, five under one of
    // them, five under one of those, each label wrapping.
    const ir = tree(
      "r>a r>b r>c r>d r>e c>f c>g c>h c>i c>j h>k h>l h>m h>n h>o",
    );
    ir.nodes.forEach((x) => (x.label = `Team ${x.id} with a longer name`));
    expect(ir.nodes).toHaveLength(16);
    const l = layoutTree(ir)!;
    expect(l).not.toBeNull();
    expect(apart(l)).toBe(true);
    expect(check(l)).toEqual([]);
  });

  it("keeps a pill a pill", () => {
    const ir = tree("a>b a>c");
    ir.nodes[0].shape = "pill";
    expect(box(layoutTree(ir)!, "a").kind).toBe("pill");
  });
});

describe("check on an org chart", () => {
  it("lets edges out of one node share their bus, and nothing else", () => {
    const l = layoutTree(org)!;
    expect(check(l)).toEqual([]);
    // The same routes without the bus are arrows on top of one another.
    const plain = check({ ...l, bus: false });
    expect(plain).toContain("a->b and a->c: run on top of each other");
    expect(plain).toContain("a->b and a->c: share an attach point");
    // Two edges ending in one point are wrong on a bus too.
    const bent = {
      ...l,
      edges: l.edges.map((r) =>
        r.to === "c"
          ? { ...r, points: l.edges.find((s) => s.to === "b")!.points }
          : r,
      ),
    };
    expect(check(bent)).toContain("a->b and a->c: share an attach point");
  });
});

describe("layoutFlow", () => {
  const elk = async () => new ELK();

  it("draws a tree the spine declines as an org chart, not with the engine", async () => {
    expect((await layoutFlow(org, elk)).bus).toBe(true);
    expect((await layoutFlow(org, elk, { tree: true })).bus).toBe(true);
  });

  // almanach's flows were drawn by the engine before the org chart existed,
  // and its pages keep that drawing.
  it("leaves a tree to the engine when the org chart is switched off", async () => {
    let asked = 0;
    const counted = async () => {
      asked++;
      return new ELK();
    };
    const l = await layoutFlow(org, counted, { tree: false });
    expect(l.bus).toBeUndefined();
    expect(asked).toBe(1);
  });

  it("keeps a chain, a path with a step aside and a labelled decision on the spine", async () => {
    const chain = await layoutFlow(tree("a>b b>c"), elk);
    expect(chain.bus).toBeUndefined();
    expect(chain.nodes.every((b) => cx(b) === cx(chain.nodes[0]))).toBe(true);
    // Trees the org chart could draw, but a process with a step aside reads
    // as a path, and stays one however long the path grows.
    for (const p of ["a>b a>c", "a>b b>c c>d b>e"]) {
      expect(isTree(tree(p)), p).toBe(true);
      expect((await layoutFlow(tree(p), elk)).bus, p).toBeUndefined();
    }
    const decision: FlowIR = {
      ...tree("a>b a>c"),
      nodes: [n("a", "ok?", "decision"), n("b"), n("c")],
      edges: [e("a", "b", "yes"), e("a", "c", "no")],
    };
    expect((await layoutFlow(decision, elk)).bus).toBeUndefined();
  });

  it("leaves a flow that rejoins to the engine", async () => {
    const l = await layoutFlow(tree("a>b a>c b>d c>d"), elk);
    expect(l.bus).toBeUndefined();
    expect(check(l)).toEqual([]);
  });
});
