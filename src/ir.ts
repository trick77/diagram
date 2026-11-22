/**
 * What a diagram says, in the shape the layouts and the drawing take: the
 * contract between a source (a mermaid parse, ./mermaid toIR; or JSON a
 * backend validated) and the picture.
 *
 * almanach's Go side validates this same shape (internal/diagram): a change
 * here is a breaking minor and an almanach Go change with it.
 */

/** start and stop are a state diagram's `[*]`: a dot where it begins, a
 * ringed dot where it ends. They carry no text. */
export type FlowShape = "pill" | "step" | "decision" | "start" | "stop";
export type FlowNodeIR = {
  id: string;
  label: string;
  shape: FlowShape;
  zone?: string;
  /** Tagged `:::focus` by the model: the part the question is about. */
  focus?: boolean;
  /** almanach's maps: production, other or none. Carried, never drawn. */
  stage?: string;
};
export type FlowEdgeIR = {
  from: string;
  to: string;
  label: string;
  dashed: boolean;
  /** Which end carries the arrowhead. */
  head: "end" | "both" | "none";
  /** almanach's maps: what the arrow is (runtime, library, build, deploy,
   * monitoring). Carried, never drawn. */
  layer?: string;
};
export type FlowIR = {
  kind: "flow";
  direction: "TB" | "LR";
  nodes: FlowNodeIR[];
  edges: FlowEdgeIR[];
  zones: { id: string; title: string }[];
};
/** How a message is drawn: its line, and what its arrow ends in. A dashed
 * line is a reply, never a boundary, so it takes no colour. */
export type SeqLine = "solid" | "dashed";
export type SeqHead = "filled" | "open" | "none" | "cross" | "both";
export type SeqRow =
  | {
      type: "message";
      from: string;
      to: string;
      label: string;
      line: SeqLine;
      head: SeqHead;
    }
  | {
      type: "note";
      /** The lifelines it sits over, or the one it sits beside. */
      from: string;
      to: string;
      side: "over" | "left" | "right";
      label: string;
    }
  /** A frame opens (`alt`, `loop`, `par` ...), is split by a divider
   * (`else`, `and`, `option`) and closes at `end`. */
  | { type: "frame"; keyword: string; label: string }
  | { type: "divider"; keyword: string; label: string }
  | { type: "end" };
export type SequenceIR = {
  kind: "sequence";
  actors: { id: string; label: string }[];
  /** Top to bottom, in the order the source wrote them. */
  rows: SeqRow[];
};
/** How many of an entity sit at one end of a relationship. */
export type Card = "one" | "zeroOrOne" | "oneOrMore" | "zeroOrMore";
export type EntityIR = {
  id: string;
  label: string;
  attrs: { type: string; name: string; keys: string[]; comment: string }[];
  focus?: boolean;
};
export type RelIR = {
  from: string;
  to: string;
  label: string;
  /** The cardinality drawn at each end: fromCard at from's box. */
  fromCard: Card;
  toCard: Card;
  /** Non-identifying, written `..`: dashed, never coloured. */
  dashed: boolean;
};
export type ERIR = {
  kind: "er";
  direction: "TB" | "LR";
  entities: EntityIR[];
  rels: RelIR[];
};
/** A topic and what hangs off it: the root's children are its branches,
 * theirs the leaves, and a leaf's children one level more. The shape the
 * source wrote a node in (`((…))`, `[…]`, `(…)`) is not kept: the level
 * says how it is drawn. */
export type MindNodeIR = {
  label: string;
  /** Tagged `:::focus` by the model, on the line after the node. */
  focus?: boolean;
  children: MindNodeIR[];
};
export type MindmapIR = { kind: "mindmap"; root: MindNodeIR };
/** A period on a timeline: its name (a date, a phase) and what happened in
 * it, top to bottom. section groups consecutive periods under a name. */
export type PeriodIR = { label: string; events: string[]; section?: string };
/** A timeline: periods in the order written, equally spaced, since the
 * source names them rather than dating them. No focus: the source has no
 * mark for one. */
export type TimelineIR = {
  kind: "timeline";
  /** Drawn as an eyebrow above; empty for none. */
  title: string;
  periods: PeriodIR[];
};
/** A point in a 2×2: x and y from 0 (left, bottom) to 1. */
export type QuadrantPointIR = {
  label: string;
  x: number;
  y: number;
  focus?: boolean;
};
export type QuadrantIR = {
  kind: "quadrant";
  /** Drawn as an eyebrow above; empty for none. */
  title: string;
  /** The word at each axis's arrow tip; empty for none. */
  xAxis: string;
  yAxis: string;
  /** quadrant-1 to quadrant-4: top right, top left, bottom left, bottom
   * right; each empty for none. */
  quadrants: [string, string, string, string];
  points: QuadrantPointIR[];
};
/** A process across roles: one lane per role, top to bottom in the order
 * written, each step in exactly one lane, the flow left to right. Steps
 * and arrows are a flow's. */
export type SwimlaneIR = {
  kind: "swimlane";
  lanes: { id: string; title: string }[];
  nodes: (Omit<FlowNodeIR, "zone"> & { lane: string })[];
  edges: FlowEdgeIR[];
};
/** A member of a class, as written after its visibility: `+find(id) T`.
 * static is underlined, abstract set in italics, as UML draws them. */
export type ClassMemberIR = {
  text: string;
  static?: boolean;
  abstract?: boolean;
};
export type ClassIR = {
  id: string;
  label: string;
  /** `interface`, `abstract`: drawn «interface» over the name. */
  stereotype?: string;
  fields: ClassMemberIR[];
  methods: ClassMemberIR[];
  focus?: boolean;
};
/** What a relationship is, by the mark at its `to` end: a hollow triangle
 * at the parent (inheritance; dashed, a realization), a filled or hollow
 * diamond at the whole (composition, aggregation), an arrowhead at the
 * class used (association; dashed, a dependency), or nothing (a link). */
export type ClassRelKind =
  "inheritance" | "composition" | "aggregation" | "association" | "link";
export type ClassRelIR = {
  from: string;
  to: string;
  kind: ClassRelKind;
  dashed: boolean;
  label: string;
  /** Multiplicities as written (`1`, `0..*`), drawn at each end; empty for
   * none. */
  fromCard: string;
  toCard: string;
};
export type ClassDiagramIR = {
  kind: "class";
  direction: "TB" | "LR";
  classes: ClassIR[];
  rels: ClassRelIR[];
};
export type DiagramIR =
  | FlowIR
  | SequenceIR
  | ERIR
  | MindmapIR
  | TimelineIR
  | QuadrantIR
  | SwimlaneIR
  | ClassDiagramIR;
