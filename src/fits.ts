import type { DiagramIR, MindNodeIR } from "./ir";

/**
 * The largest diagram drawn editorially. Past these the layout stops
 * reading as composed, and a generic renderer's drawing (or a refusal) is no
 * worse than a crowded one of ours.
 */
export type Limits = {
  /** A flow: the prompt asks for at most 12 nodes. */
  nodes: number;
  edges: number;
  /** A sequence: the prompt asks for at most 5 participants and 12
   * messages; the same slack over it as a flow gets. Wider than this a
   * sequence is too small to read inline in either drawing. */
  actors: number;
  rows: number;
  /** Which rows count against `rows`: messages and notes only, or every
   * row, frames included (almanach's backend counts that way). */
  countFrames: boolean;
  /** An entity model: tables are larger than steps, so fewer of them fit
   * the answer's width before every field is too small to read. */
  entities: number;
  rels: number;
  attrs: number;
  /** A mindmap: branches around the root, four to a side; children under
   * any branch or leaf; levels below the root. Past them a side outgrows
   * the root it hangs off. */
  mindmapBranches: number;
  mindmapChildren: number;
  mindmapDepth: number;
  /** A timeline: standing, twelve periods already run past a screen's
   * height; a period holding more than a few events is a list, not a
   * point in time. */
  periods: number;
  events: number;
  /** A quadrant: past a dozen points the labels crowd one another off
   * their dots. */
  points: number;
  /** A swimlane: its steps and arrows count as a flow's; past five lanes a
   * step's lane is too far from its name to read across. */
  lanes: number;
  /** A class diagram: a class is a table with a second compartment, so as
   * few as an entity model holds, and fewer lines in each. */
  classes: number;
  classRels: number;
  members: number;
};

/** The levels below the root a mindmap's layout draws: branch, leaf, and a
 * leaf's children. */
const mindmapLevels = 3;

export const limits: Limits = {
  nodes: 16,
  edges: 24,
  actors: 8,
  rows: 20,
  countFrames: false,
  entities: 8,
  rels: 12,
  attrs: 12,
  mindmapBranches: 8,
  mindmapChildren: 4,
  mindmapDepth: 3,
  periods: 12,
  events: 4,
  points: 12,
  lanes: 5,
  classes: 8,
  classRels: 12,
  members: 10,
};

/** fits says whether a diagram is within the limits, rongo's unless the
 * caller overrides some. almanach's maps hold more (22 nodes, 33 edges:
 * every external system is its own box, and its layout wraps rows); its
 * backend's caps go in here, changed on both sides together. */
export function fits(ir: DiagramIR, over: Partial<Limits> = {}): boolean {
  const l = { ...limits, ...over };
  if (ir.kind === "sequence") {
    const rows = l.countFrames
      ? ir.rows
      : ir.rows.filter((r) => r.type === "message" || r.type === "note");
    return ir.actors.length <= l.actors && rows.length <= l.rows;
  }
  if (ir.kind === "er")
    return (
      ir.entities.length <= l.entities &&
      ir.rels.length <= l.rels &&
      ir.entities.every((e) => e.attrs.length <= l.attrs)
    );
  if (ir.kind === "mindmap") {
    // The layout draws three levels below the root (mindmap.ts block): a
    // cap raised past them would let a deeper node vanish without a word.
    const deepest = Math.min(l.mindmapDepth, mindmapLevels);
    const within = (n: MindNodeIR, depth: number): boolean =>
      n.children.length <= l.mindmapChildren &&
      (n.children.length === 0 || depth < deepest) &&
      n.children.every((c) => within(c, depth + 1));
    return (
      ir.root.children.length <= l.mindmapBranches &&
      ir.root.children.every((b) => within(b, 1))
    );
  }
  if (ir.kind === "timeline")
    return (
      ir.periods.length <= l.periods &&
      ir.periods.every((p) => p.events.length <= l.events)
    );
  if (ir.kind === "quadrant") return ir.points.length <= l.points;
  if (ir.kind === "class")
    return (
      ir.classes.length <= l.classes &&
      ir.rels.length <= l.classRels &&
      ir.classes.every((c) => c.fields.length + c.methods.length <= l.members)
    );
  if (ir.kind === "swimlane" && ir.lanes.length > l.lanes) return false;
  // A flow with no node draws nothing worth a card.
  return (
    ir.nodes.length > 0 &&
    ir.nodes.length <= l.nodes &&
    ir.edges.length <= l.edges
  );
}
