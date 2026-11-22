import type { FlowIR } from "./ir";
import {
  boxWidth,
  frame,
  lay,
  type EdgeRoute,
  type FlowLayout,
  type NodeBox,
  type Point,
} from "./layout";

/**
 * A top-down flowchart that is a tree, drawn as an org chart: the root on
 * top, each node's children side by side in a row under it, in the order
 * written, joined by a bus: a drop from the parent, a line along the row,
 * a drop into each child. Every box one width, every connector bent at
 * right angles, as in the other flow layouts.
 *
 * Only a tree the spine declines comes here (layoutFlow asks the spine
 * first), in place of the engine. A path with a step to its side, or a
 * decision with its labelled branches, reads as a process, which the spine
 * draws: a decision's yes and no are a path and a way off it, not two
 * equal children. A labelled, dotted or diamond tree, or one deeper or
 * wider than an org chart reads at the width of an answer, goes on to the
 * engine, as it did before there was this one.
 */

/** The largest tree drawn as one: levels including the root, children
 * under one node. Five children of the widest box are about the width of
 * an answer. */
export const treeLevels = 4;
export const treeChildren = 5;

/** From a parent's foot to its bus, and from the bus to a child's top: the
 * second holds the arrowhead. */
const drop = 28;
const childDrop = 32;
/** Between two neighbouring subtrees. */
const siblingGap = 32;

/** treeOf is a flow's children by node, in the order written, and its
 * root, when the flow is a tree this layout draws; otherwise null. */
function treeOf(
  ir: FlowIR,
): { root: string; kids: Map<string, string[]> } | null {
  if (ir.direction !== "TB" || ir.zones.length > 0) return null;
  if (ir.edges.length !== ir.nodes.length - 1) return null;
  // A box of a step or a pill: a diamond is a decision, its branches a
  // path and a way off it; a dot is a state diagram's.
  if (ir.nodes.some((n) => n.shape !== "step" && n.shape !== "pill"))
    return null;
  // A label or a dotted line belongs to one edge, and on a bus the edges
  // out of a node share their first stretch.
  if (ir.edges.some((e) => e.label !== "" || e.dashed)) return null;
  const kids = new Map(ir.nodes.map((n) => [n.id, [] as string[]]));
  const parent = new Map<string, string>();
  for (const e of ir.edges) {
    if (e.from === e.to || parent.has(e.to)) return null;
    parent.set(e.to, e.from);
    kids.get(e.from)!.push(e.to);
  }
  const roots = ir.nodes.filter((n) => !parent.has(n.id));
  if (roots.length !== 1) return null;
  const root = roots[0].id;
  // Reached from the root, level by level: a cycle off to the side has one
  // parent per node and the right edge count, and is no tree.
  let level = [root];
  let seen = 1;
  let depth = 1;
  for (;;) {
    const next = level.flatMap((id) => kids.get(id)!);
    if (next.length === 0) break;
    if (++depth > treeLevels) return null;
    seen += next.length;
    level = next;
  }
  if (seen !== ir.nodes.length) return null;
  const widths = [...kids.values()].map((k) => k.length);
  if (Math.max(...widths) < 2 || Math.max(...widths) > treeChildren)
    return null;
  return { root, kids };
}

/** isTree says a flow is drawn as an org chart. */
export function isTree(ir: FlowIR): boolean {
  return treeOf(ir) !== null;
}

/** layoutTree places a tree as an org chart, or returns null for any flow
 * that is not one. */
export function layoutTree(ir: FlowIR): FlowLayout | null {
  const tree = treeOf(ir);
  if (tree === null) return null;
  const { root, kids } = tree;
  const w = boxWidth(ir.nodes, 128, 200);
  const boxes = new Map<string, NodeBox>(
    ir.nodes.map((n) => [
      n.id,
      lay(n, n.shape === "pill" ? "pill" : "step", w),
    ]),
  );

  // Rows: a level's boxes share a top, its tallest sets where the next
  // begins.
  const depth = new Map<string, number>([[root, 0]]);
  const rows: string[][] = [[root]];
  for (let d = 0; d < rows.length; d++) {
    const next = rows[d].flatMap((id) => kids.get(id)!);
    next.forEach((id) => depth.set(id, d + 1));
    if (next.length > 0) rows.push(next);
  }
  const rowTop: number[] = [];
  const busY: number[] = [];
  let y = 0;
  for (const row of rows) {
    rowTop.push(y);
    const h = Math.max(...row.map((id) => boxes.get(id)!.h));
    busY.push(y + h + drop);
    y += h + drop + childDrop;
  }

  // Across: a subtree is as wide as its children's side by side, or its
  // own box. Children are centred under their parent's room, a parent over
  // the middle of its first and last child: whole pixels, so every drop is
  // exactly vertical.
  const span = new Map<string, number>();
  const width = (id: string): number => {
    const k = kids.get(id)!;
    const s = Math.max(
      w,
      k.reduce((a, c) => a + width(c), 0) + siblingGap * (k.length - 1),
    );
    span.set(id, s);
    return s;
  };
  width(root);
  const centre = new Map<string, number>();
  const place = (id: string, left: number) => {
    const k = kids.get(id)!;
    const b = boxes.get(id)!;
    b.y = rowTop[depth.get(id)!];
    if (k.length === 0) {
      centre.set(id, left + w / 2);
    } else {
      const inner =
        k.reduce((a, c) => a + span.get(c)!, 0) + siblingGap * (k.length - 1);
      let x = left + Math.round((span.get(id)! - inner) / 2);
      for (const c of k) {
        place(c, x);
        x += span.get(c)! + siblingGap;
      }
      centre.set(
        id,
        Math.round((centre.get(k[0])! + centre.get(k[k.length - 1])!) / 2),
      );
    }
    b.x = centre.get(id)! - w / 2;
  };
  place(root, 0);

  const edges: EdgeRoute[] = ir.edges.map((e) => {
    const p = boxes.get(e.from)!;
    const c = boxes.get(e.to)!;
    const px = centre.get(e.from)!;
    const cx = centre.get(e.to)!;
    const bus = busY[depth.get(e.from)!];
    const points: Point[] =
      px === cx
        ? [
            { x: px, y: p.y + p.h },
            { x: cx, y: c.y },
          ]
        : [
            { x: px, y: p.y + p.h },
            { x: px, y: bus },
            { x: cx, y: bus },
            { x: cx, y: c.y },
          ];
    return {
      from: e.from,
      to: e.to,
      points,
      dashed: false,
      warn: false,
      head: e.head,
    };
  });
  return { ...frame([...boxes.values()], edges, []), bus: true };
}
