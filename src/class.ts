import type {
  ClassDiagramIR,
  ClassIR,
  ClassMemberIR,
  ClassRelKind,
} from "./ir";
import {
  elkEdge,
  elkLabel,
  elkPoints,
  frame,
  labelBox,
  px,
  type EdgeRoute,
  type Elk,
  type FlowLayout,
  type LabelBox,
  type NodeBox,
  type Point,
} from "./layout";
import { tablePad } from "./er";
import { ramp, textWidth, wrap } from "./theme";

/**
 * Where a class diagram goes: each class a box of three compartments (its
 * name on the tint, under a muted stereotype where it has one; its fields;
 * its methods, both in the mono), each relationship a square-cornered line
 * marked at one end by what it is, its multiplicities beside its ends and
 * its name mid-line. ELK places the boxes and routes the lines, as it does
 * an entity model's tables (er.ts), so the connector rules a flowchart is
 * held to (check/check.ts) hold here too.
 *
 * A parent sits above its children, a whole above its parts and a class
 * above the classes it uses: the engine is handed every inheritance,
 * composition and aggregation from the marked end, every association from
 * the class that holds it.
 */

/** A member, wrapped to lines; static underlined, abstract in italics. */
export type MemberLines = {
  lines: string[];
  static: boolean;
  abstract: boolean;
};
export type ClassBox = {
  /** `«interface»`, or null for a plain class. */
  stereotype: string | null;
  name: string[];
  /** The compartments' heights, top to bottom. */
  head: number;
  fieldsH: number;
  methodsH: number;
  fields: MemberLines[];
  methods: MemberLines[];
};
/** What is drawn where a relationship meets a class. */
export type Mark = "triangle" | "diamond" | "filledDiamond" | "arrow";
export type RelEnd = { mark: Mark | null; card?: LabelBox };
export type ClassLayout = FlowLayout & {
  classes: Map<string, ClassBox>;
  /** Per edge, what its from end (its first point) and its to end carry. */
  ends: { from: RelEnd; to: RelEnd }[];
};

/** A member's line, and the room above and below a compartment's lines. An
 * empty compartment stays a thin band, as the sketch of the type drew it:
 * gone, a class with methods only read as one with fields only. */
export const memberLine = 18;
export const compPad = 7;
export const emptyComp = 10;
/** The head: room around the name, and the stereotype's line over it. */
export const headPad = 11;
export const stereoLine = 16;
/** The least width of a class, and the widest a member or name runs
 * before it wraps. */
const classMin = 140;
const textMax = 320;

/** How far each mark reaches along its line from the class. */
export const markLength: Record<Mark, number> = {
  triangle: 12,
  diamond: 16,
  filledDiamond: 16,
  arrow: 10,
};
const marks: Record<ClassRelKind, Mark | null> = {
  inheritance: "triangle",
  composition: "filledDiamond",
  aggregation: "diamond",
  association: "arrow",
  link: null,
};
/** The kinds laid out from their marked end: the parent, the whole. */
const fromMark = new Set<ClassRelKind>([
  "inheritance",
  "composition",
  "aggregation",
]);

const lines = (m: ClassMemberIR): MemberLines => ({
  lines: wrap(m.text, textMax, ramp.label, "mono"),
  static: m.static ?? false,
  abstract: m.abstract ?? false,
});

const compartment = (ms: MemberLines[]) => {
  const n = ms.reduce((k, m) => k + m.lines.length, 0);
  return n === 0 ? emptyComp : n * memberLine + 2 * compPad;
};

/** box sizes a class: as wide as its widest line, each compartment as tall
 * as its lines, never padded to its neighbours'. */
function box(c: ClassIR): { b: ClassBox; w: number; h: number } {
  const stereotype = c.stereotype ? `«${c.stereotype}»` : null;
  const name = wrap(c.label, textMax, ramp.bold, "sans");
  const fields = c.fields.map(lines);
  const methods = c.methods.map(lines);
  const widest = Math.max(
    ...name.map((l) => textWidth(l, ramp.bold, "sans")),
    stereotype ? textWidth(stereotype, ramp.label, "sans") : 0,
    ...[...fields, ...methods].flatMap((m) =>
      m.lines.map((l) => textWidth(l, ramp.label, "mono")),
    ),
  );
  const head =
    2 * headPad + (stereotype ? stereoLine : 0) + name.length * ramp.lineHeight;
  const b: ClassBox = {
    stereotype,
    name,
    head,
    fieldsH: compartment(fields),
    methodsH: compartment(methods),
    fields,
    methods,
  };
  return {
    b,
    w: Math.max(classMin, Math.ceil(widest) + 2 * tablePad),
    h: head + b.fieldsH + b.methodsH,
  };
}

export async function layoutClass(
  ir: ClassDiagramIR,
  elk: Elk,
): Promise<ClassLayout> {
  const classes = new Map<string, ClassBox>();
  const boxes = new Map<string, NodeBox>();
  for (const c of ir.classes) {
    const { b, w, h } = box(c);
    classes.set(c.id, b);
    boxes.set(c.id, {
      id: c.id,
      kind: "step",
      lines: b.name,
      face: "sans",
      size: ramp.bold,
      bold: true,
      focus: c.focus ?? false,
      x: 0,
      y: 0,
      w,
      h,
    });
  }
  const labels = ir.rels.map((r) =>
    r.label !== "" ? labelBox(r.label) : null,
  );
  // Each relationship as the engine gets it: source above target.
  const flip = ir.rels.map((r) => fromMark.has(r.kind));
  const root = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": ir.direction === "TB" ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      // An entity model's spacing (er.ts), wider between lines: beside each
      // end stands a multiplicity, which the engine does not know about.
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "24",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
      "elk.layered.spacing.edgeNodeBetweenLayers": "32",
      "elk.spacing.edgeLabel": "10",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
    },
    children: ir.classes.map((c) => ({
      id: c.id,
      width: boxes.get(c.id)!.w,
      height: boxes.get(c.id)!.h,
    })),
    edges: ir.rels.map((r, i) =>
      flip[i]
        ? elkEdge(`e${i}`, r.to, r.from, r.label, labels[i])
        : elkEdge(`e${i}`, r.from, r.to, r.label, labels[i]),
    ),
  });
  for (const c of root.children ?? []) {
    const b = boxes.get(c.id)!;
    b.x = px(c.x ?? 0);
    b.y = px(c.y ?? 0);
  }
  const ends: ClassLayout["ends"] = [];
  const routes: EdgeRoute[] = (root.edges ?? []).map((e, i) => {
    const r = ir.rels[i];
    const [from, to] = flip[i] ? [r.to, r.from] : [r.from, r.to];
    const [fromCard, toCard] = flip[i]
      ? [r.toCard, r.fromCard]
      : [r.fromCard, r.toCard];
    const mark = marks[r.kind];
    const route: EdgeRoute = {
      from,
      to,
      points: elkPoints(e),
      // A dash here is a kind of relationship (a realization, a
      // dependency), never a boundary: muted, as an entity model's.
      dashed: r.dashed,
      warn: false,
      head: "none",
    };
    const label = elkLabel(e, labels[i]);
    if (label) route.label = label;
    const p = route.points;
    const n = p.length;
    const atFrom: RelEnd = { mark: flip[i] ? mark : null };
    const atTo: RelEnd = { mark: flip[i] ? null : mark };
    if (n >= 2) {
      if (fromCard !== "")
        atFrom.card = card(fromCard, p, boxes.get(from)!, atFrom.mark);
      if (toCard !== "")
        atTo.card = card(toCard, [...p].reverse(), boxes.get(to)!, atTo.mark);
    }
    ends.push({ from: atFrom, to: atTo });
    return route;
  });
  const nodes = ir.classes.map((c) => boxes.get(c.id)!);
  const cards = ends.flatMap((e) =>
    [e.from.card, e.to.card].filter((c): c is LabelBox => c !== undefined),
  );
  return { ...frame(nodes, routes, [], cards), classes, ends };
}

/** Clear space between a multiplicity and its line, and past the mark at
 * its end. */
const cardGap = 6;

/** card places a multiplicity beside a line's end (pts runs from that
 * end): past the end's mark, on the side the line does not turn to, so a
 * short first stretch never runs into it. A straight line takes the side
 * away from the class's middle, so two ends on one side of a class keep
 * theirs apart. */
function card(
  text: string,
  pts: Point[],
  b: NodeBox,
  mark: Mark | null,
): LabelBox {
  // A multiplicity is notation, not prose: as written, at the label size.
  const l = labelBox(text, false);
  const [end, next, turn] = pts;
  const along = (mark ? markLength[mark] : 0) + 4;
  if (end.x === next.x) {
    const down = next.y > end.y;
    const right = turn ? turn.x < next.x : end.x >= b.x + b.w / 2;
    return {
      ...l,
      x: right ? end.x + cardGap : end.x - cardGap - l.w,
      y: down ? end.y + along : end.y - along - l.h,
    };
  }
  const ahead = next.x > end.x;
  const above = turn ? turn.y > next.y : end.y <= b.y + b.h / 2;
  return {
    ...l,
    x: ahead ? end.x + along : end.x - along - l.w,
    y: above ? end.y - cardGap - l.h : end.y + cardGap,
  };
}
