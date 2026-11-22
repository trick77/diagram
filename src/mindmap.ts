import type { MindNodeIR, MindmapIR } from "./ir";
import { looksLikeCode, margin, type Point } from "./layout";
import { ramp, textWidth, wrap, type Face } from "./theme";

/**
 * A mindmap laid out by hand, the way one is drawn on paper: the topic in
 * the middle, its branches around it clockwise (down the right side from
 * the top, then up the left side from the bottom), the two sides balanced by
 * how tall their branches stand, each branch's leaves stacked beside it and
 * a leaf's own children indented under it. Connectors are smooth curves,
 * the one kind of diagram here whose lines are not bent at right angles: a
 * mindmap drawn with a flowchart's elbows read as an org chart on its side.
 *
 * The topic and the branches are pills, leaves plain text: the frames say
 * what the map is about, the leaves are its notes.
 */

/** A node's place: level 0 the topic, 1 a branch, 2 a leaf, 3 a leaf's own
 * child. side is the side of the topic it hangs on, 0 for the topic. */
export type MindBox = {
  id: string;
  level: number;
  side: -1 | 0 | 1;
  lines: string[];
  face: Face;
  size: number;
  bold: boolean;
  focus: boolean;
  /** The text's inset from the box's sides: a pill's padding, none for a
   * leaf, whose box is its text. */
  padX: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
/** A cubic curve from a node to one of its children: start, two control
 * points, end. focus is the child's: the curve into a marked node is
 * drawn in the accent. */
export type MindLink = {
  from: string;
  to: string;
  level: number;
  points: [Point, Point, Point, Point];
  focus: boolean;
};
export type MindmapLayout = {
  width: number;
  height: number;
  nodes: MindBox[];
  links: MindLink[];
};

/** How each level is set: the topic and the branches in the bold, in a
 * pill; leaves in the text size with no frame. A wider label wraps. */
const levels = [
  { size: ramp.bold, bold: true, max: 200, padX: 18, padY: 11 },
  { size: ramp.bold, bold: true, max: 176, padX: 14, padY: 6 },
  { size: ramp.text, bold: false, max: 200, padX: 0, padY: 4 },
  { size: ramp.text, bold: false, max: 184, padX: 0, padY: 4 },
];

/** From the topic's side to the near end of a branch: room for the curves
 * to fan out. */
const branchReach = 64;
/** From a branch's far end to its leaves' text. */
const leafReach = 40;
/** The gap a curve stops short of a leaf's text, which has no frame to
 * meet. */
const leafGap = 8;
/** A leaf's children sit this far further out than the leaf. */
const indent = 16;
/** Vertical space between two branches' blocks on one side, and between
 * two stacked leaves. */
const blockGap = 20;
const stackGap = 4;

const up2 = (v: number) => Math.ceil(v / 2) * 2;

function box(n: MindNodeIR, id: string, level: number): MindBox {
  const lv = levels[Math.min(level, levels.length - 1)];
  const code = looksLikeCode(n.label);
  const face: Face = code ? "mono" : "sans";
  const size = code ? ramp.code : lv.size;
  const lines = wrap(n.label, lv.max, size, face);
  const tw = Math.max(...lines.map((l) => textWidth(l, size, face)));
  return {
    id,
    level,
    side: 0,
    lines,
    face,
    size,
    bold: lv.bold && !code,
    focus: n.focus ?? false,
    padX: lv.padX,
    x: 0,
    y: 0,
    w: up2(tw + 2 * lv.padX),
    h: lines.length * ramp.lineHeight + 2 * lv.padY,
  };
}

/** A branch with its leaves and theirs, measured before it is placed. */
type Block = {
  branch: MindBox;
  leaves: { leaf: MindBox; subs: MindBox[]; h: number }[];
  /** The leaves' stack, and the block's: the taller of it and the pill. */
  stack: number;
  h: number;
};

function block(b: MindNodeIR, id: string): Block {
  const leaves = b.children.map((l, i) => {
    const leaf = box(l, `${id}.${i + 1}`, 2);
    const subs = l.children.map((s, j) => box(s, `${leaf.id}.${j + 1}`, 3));
    const h = subs.reduce((a, s) => a + stackGap + s.h, leaf.h);
    return { leaf, subs, h };
  });
  const stack =
    leaves.reduce((a, l) => a + l.h, 0) +
    stackGap * Math.max(0, leaves.length - 1);
  const branch = box(b, id, 1);
  return { branch, leaves, stack, h: Math.max(branch.h, stack) };
}

/** split is how many of the blocks, in the order written, go on the right:
 * the count that leaves the two sides closest in height, the right taking
 * the larger share on a tie. */
export function split(heights: number[]): number {
  const n = heights.length;
  if (n < 2) return n;
  const side = (hs: number[]) =>
    hs.reduce((a, h) => a + h, 0) + blockGap * (hs.length - 1);
  let best = 1;
  let diff = Infinity;
  for (let k = 1; k < n; k++) {
    const d = Math.abs(side(heights.slice(0, k)) - side(heights.slice(k)));
    if (d <= diff) {
      best = k;
      diff = d;
    }
  }
  return best;
}

const curve = (a: Point, b: Point): [Point, Point, Point, Point] => {
  const mx = (a.x + b.x) / 2;
  return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
};

/** layoutMindmap places a mindmap around its topic. */
export function layoutMindmap(ir: MindmapIR): MindmapLayout {
  const root = box(ir.root, "root", 0);
  root.x = -root.w / 2;
  root.y = -root.h / 2;
  const nodes: MindBox[] = [root];
  const links: MindLink[] = [];
  const link = (from: MindBox, to: MindBox, a: Point, b: Point, k = curve) =>
    links.push({
      from: from.id,
      to: to.id,
      level: to.level,
      points: k(a, b),
      focus: to.focus,
    });

  const blocks = ir.root.children.map((b, i) => block(b, `${i + 1}`));
  const k = split(blocks.map((b) => b.h));
  // Clockwise: the right side top to bottom, then the left bottom to top,
  // which drawn top to bottom is its blocks reversed.
  const sides: [1 | -1, Block[]][] = [
    [1, blocks.slice(0, k)],
    [-1, blocks.slice(k).reverse()],
  ];
  const near = root.w / 2 + branchReach;
  for (const [s, side] of sides) {
    // x along the side, measured out from the topic's centre.
    const X = (d: number) => s * d;
    // A box reaching from d out to d + w, on this side.
    const place = (b: MindBox, d: number) => {
      b.side = s;
      b.x = s === 1 ? d : -d - b.w;
    };
    const total =
      side.reduce((a, b) => a + b.h, 0) +
      blockGap * Math.max(0, side.length - 1);
    let y = -total / 2;
    for (const bl of side) {
      const br = bl.branch;
      const cy = y + bl.h / 2;
      place(br, near);
      br.y = cy - br.h / 2;
      nodes.push(br);
      link(root, br, { x: X(root.w / 2), y: 0 }, { x: X(near), y: cy });
      const far = near + br.w;
      const anchor = far + leafReach;
      let ly = cy - bl.stack / 2;
      for (const { leaf, subs, h } of bl.leaves) {
        place(leaf, anchor);
        leaf.y = ly;
        nodes.push(leaf);
        link(
          br,
          leaf,
          { x: X(far), y: cy },
          { x: X(anchor - leafGap), y: firstLine(leaf) },
        );
        // A leaf's children hang under it, each reached by a curve that
        // drops from the leaf's foot and turns out to the child.
        let sy = leaf.y + leaf.h + stackGap;
        for (const sub of subs) {
          place(sub, anchor + indent);
          sub.y = sy;
          nodes.push(sub);
          link(
            leaf,
            sub,
            { x: X(anchor + 4), y: leaf.y + leaf.h },
            { x: X(anchor + indent - 4), y: firstLine(sub) },
            hook,
          );
          sy += sub.h + stackGap;
        }
        ly += h + stackGap;
      }
      y += bl.h + blockGap;
    }
  }
  return frameMap(nodes, links);
}

const firstLine = (b: MindBox) =>
  b.y + levels[b.level].padY + ramp.lineHeight / 2;

/** hook is a curve that drops straight down and turns out at the end, like
 * an outline's elbow with its corner rounded away. */
const hook = (a: Point, b: Point): [Point, Point, Point, Point] => [
  a,
  { x: a.x, y: b.y },
  { x: a.x, y: b.y },
  b,
];

/** frameMap moves the map so its outermost marks sit margin in, and sizes
 * the canvas around it. A curve keeps inside the box of its ends and its
 * control points, which lie between them. */
function frameMap(nodes: MindBox[], links: MindLink[]): MindmapLayout {
  const pts = links.flatMap((l) => l.points);
  const minX = Math.min(...nodes.map((n) => n.x), ...pts.map((p) => p.x));
  const minY = Math.min(...nodes.map((n) => n.y), ...pts.map((p) => p.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w), ...pts.map((p) => p.x));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h), ...pts.map((p) => p.y));
  const dx = margin - minX;
  const dy = margin - minY;
  for (const n of nodes) {
    n.x += dx;
    n.y += dy;
  }
  for (const l of links) {
    l.points = l.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) as [
      Point,
      Point,
      Point,
      Point,
    ];
  }
  return {
    width: Math.ceil(maxX - minX + 2 * margin),
    height: Math.ceil(maxY - minY + 2 * margin),
    nodes,
    links,
  };
}
