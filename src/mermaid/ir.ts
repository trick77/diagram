/**
 * What a diagram says, read out of the mermaid renderer's own parse, in the
 * shape the drawing (../draw.ts) takes.
 *
 * The model writes mermaid and that stays the stored form; only the picture
 * is ours. Reading the renderer's parse rather than the text means the
 * fence is accepted exactly as far as it was before: what mermaid.parse
 * takes, this reads, and there is no second grammar to drift from the first.
 *
 * This is the one file that knows the renderer's internals (the db behind
 * getDiagramFromText), so a renderer bump that moves them breaks here and in
 * the corpus test, never on screen. It degrades per element: an unknown
 * shape draws as a step, an edge to an undeclared node is dropped. What it
 * cannot draw honestly at all is null, and the renderer draws that as it
 * always did.
 */
import { asSwimlane, laneFlow } from "../swimlane";
import { limits } from "../fits";
import type {
  Card,
  ClassDiagramIR,
  ClassIR,
  ClassMemberIR,
  ClassRelIR,
  ClassRelKind,
  SwimlaneIR,
  DiagramIR,
  ERIR,
  EntityIR,
  FlowEdgeIR,
  FlowIR,
  FlowNodeIR,
  FlowShape,
  MindNodeIR,
  MindmapIR,
  PeriodIR,
  QuadrantIR,
  QuadrantPointIR,
  RelIR,
  SeqHead,
  SeqLine,
  SeqRow,
  SequenceIR,
  TimelineIR,
} from "../ir";

/** toIR reads the db of a parsed diagram, or returns null for a kind or a
 * construct the drawing does not cover. */
export function toIR(type: string, db: unknown): DiagramIR | null {
  try {
    if (type === "flowchart-v2" || type === "flowchart")
      return lanes(flowIR(db));
    if (type === "sequence") return sequenceIR(db);
    if (type === "stateDiagram" || type === "state") return stateIR(db);
    if (type === "er") return erIR(db);
    if (type === "mindmap") return mindmapIR(db);
    if (type === "timeline") return timelineIR(db);
    if (type === "quadrantChart") return quadrantIR(db);
    if (type === "classDiagram" || type === "class") return classIR(db);
  } catch {
    // A db missing an accessor this reads is a renderer that moved on; the
    // renderer then draws the source itself.
  }
  return null;
}

type FlowDb = {
  getVertices(): Map<
    string,
    { id: string; text?: string; type?: string; classes?: string[] }
  >;
  getEdges(): {
    start: string;
    end: string;
    type?: string;
    text?: string;
    stroke?: string;
  }[];
  getSubGraphs(): { id: string; title?: string; nodes: string[] }[];
  getDirection(): string | undefined;
};

function isFlowDb(db: unknown): db is FlowDb {
  if (typeof db !== "object" || db === null) return false;
  const d = db as Record<string, unknown>;
  return ["getVertices", "getEdges", "getSubGraphs", "getDirection"].every(
    (k) => typeof d[k] === "function",
  );
}

/** Pills are where a flow starts or stops; a diamond is a decision; every
 * other mermaid shape is a step, because shape carries type and the
 * drawing's flows have only those three. */
const pills = new Set(["stadium", "circle", "doublecircle", "ellipse"]);

function flowIR(db: unknown): FlowIR | null {
  if (!isFlowDb(db)) return null;
  // Bottom-up and right-to-left are orders the layouts do not draw; read as
  // their mirror, a stack would come out upside down.
  const dir = db.getDirection() ?? "TB";
  if (dir === "BT" || dir === "RL") return null;
  const subgraphs = db.getSubGraphs();
  const zoneIds = new Set(subgraphs.map((s) => s.id));
  const zoneOf = new Map<string, string>();
  for (const s of subgraphs) {
    for (const n of s.nodes) {
      // A subgraph listing another one nests, and nesting is a picture this
      // does not draw.
      if (zoneIds.has(n)) return null;
      if (!zoneOf.has(n)) zoneOf.set(n, s.id);
    }
  }
  const nodes: FlowNodeIR[] = [];
  const known = new Set<string>();
  for (const v of db.getVertices().values()) {
    if (typeof v.id !== "string" || v.id === "" || known.has(v.id)) continue;
    known.add(v.id);
    const node: FlowNodeIR = {
      id: v.id,
      label: plain(v.text ?? "") || v.id,
      shape:
        v.type === "diamond"
          ? "decision"
          : pills.has(v.type ?? "")
            ? "pill"
            : "step",
    };
    const zone = zoneOf.get(v.id);
    if (zone !== undefined) node.zone = zone;
    if (v.classes?.includes("focus")) node.focus = true;
    nodes.push(node);
  }
  const edges: FlowEdgeIR[] = [];
  for (const e of db.getEdges()) {
    // An edge to a subgraph lands on its frame, which the layout cannot
    // route to as it routes to a node.
    if (zoneIds.has(e.start) || zoneIds.has(e.end)) return null;
    if (!known.has(e.start) || !known.has(e.end)) continue;
    // `~~~` is a layout hint, not a connection.
    if (e.stroke === "invisible") continue;
    edges.push({
      from: e.start,
      to: e.end,
      label: plain(e.text ?? ""),
      dashed: e.stroke === "dotted",
      head: headOf(e.type ?? ""),
    });
  }
  if (nodes.length === 0) return null;
  return {
    kind: "flow",
    direction: dir === "LR" ? "LR" : "TB",
    nodes,
    edges,
    // A subgraph holding no node is no zone: drawn, it is an empty frame,
    // and counted, it would keep the flow from the layouts built for it.
    zones: subgraphs
      .filter((s) => nodes.some((n) => n.zone === s.id))
      .map((s) => ({ id: s.id, title: plain(s.title ?? "") })),
  };
}

type SequenceDb = {
  getActors(): Map<string, { name?: string; description?: string }>;
  getMessages(): {
    from?: string;
    to?: string;
    type?: number;
    // An object on an autonumber record ({ visible, start, step }).
    message?: unknown;
    placement?: number;
  }[];
  getBoxes(): unknown[];
  getCreatedActors(): Map<string, unknown>;
  getDestroyedActors(): Map<string, unknown>;
  getDiagramTitle?(): string;
};

function isSequenceDb(db: unknown): db is SequenceDb {
  if (typeof db !== "object" || db === null) return false;
  const d = db as Record<string, unknown>;
  return [
    "getActors",
    "getMessages",
    "getBoxes",
    "getCreatedActors",
    "getDestroyedActors",
  ].every((k) => typeof d[k] === "function");
}

/** The renderer's line types (its LINETYPE table), the ones drawn. */
const arrows: Record<number, [SeqLine, SeqHead]> = {
  0: ["solid", "filled"],
  1: ["dashed", "filled"],
  3: ["solid", "cross"],
  4: ["dashed", "cross"],
  5: ["solid", "none"],
  6: ["dashed", "none"],
  24: ["solid", "open"],
  25: ["dashed", "open"],
  33: ["solid", "both"],
  34: ["dashed", "both"],
};
const note = 2;
const frames: Record<number, string> = {
  10: "loop",
  12: "alt",
  15: "opt",
  19: "par",
  27: "critical",
  30: "break",
};
const dividers: Record<number, string> = {
  13: "else",
  20: "and",
  28: "option",
};
const ends = new Set([11, 14, 16, 21, 29, 31]);
/** How deep frames may sit inside one another. */
const maxDepth = 3;
/** activate and deactivate: a bar on the lifeline, which this does not
 * draw, and nothing else changes. */
const ignored = new Set([17, 18]);
/** autonumber: numbering is declined, `autonumber off` is nothing. The
 * parse sets no flag for it; the record says which. */
const autonumber = 26;
const sides = ["left", "right", "over"] as const;

function sequenceIR(db: unknown): SequenceIR | null {
  if (!isSequenceDb(db)) return null;
  // Groups of participants, participants arriving or leaving mid-way and a
  // title above the picture are things this does not draw; the renderer
  // does.
  if (
    (db.getDiagramTitle?.() ?? "") !== "" ||
    db.getBoxes().length > 0 ||
    db.getCreatedActors().size > 0 ||
    db.getDestroyedActors().size > 0
  )
    return null;
  const actors: SequenceIR["actors"] = [];
  for (const [id, a] of db.getActors()) {
    if (typeof id !== "string" || id === "") continue;
    actors.push({ id, label: plain(a.description ?? a.name ?? "") || id });
  }
  if (actors.length === 0) return null;
  const known = new Set(actors.map((a) => a.id));
  const rows: SeqRow[] = [];
  let depth = 0;
  for (const m of db.getMessages()) {
    const t = m.type ?? -1;
    const label = plain(typeof m.message === "string" ? m.message : "");
    if (t in arrows) {
      if (!known.has(m.from ?? "") || !known.has(m.to ?? "")) continue;
      const [line, head] = arrows[t];
      rows.push({
        type: "message",
        from: m.from!,
        to: m.to!,
        label,
        line,
        head,
      });
    } else if (t === note) {
      if (!known.has(m.from ?? "") || !known.has(m.to ?? "")) continue;
      const side = sides[m.placement ?? 2] ?? "over";
      rows.push({ type: "note", from: m.from!, to: m.to!, side, label });
    } else if (t in frames) {
      // A frame inside a frame is drawn inset in it. Deeper than a few the
      // insets eat the columns, and the renderer's drawing is no worse.
      if (++depth > maxDepth) return null;
      rows.push({ type: "frame", keyword: frames[t], label });
    } else if (t in dividers) {
      if (depth === 0) return null;
      rows.push({ type: "divider", keyword: dividers[t], label });
    } else if (ends.has(t)) {
      if (depth === 0) return null;
      depth--;
      rows.push({ type: "end" });
    } else if (t === autonumber) {
      const on = (m.message as { visible?: unknown } | undefined)?.visible;
      if (on !== false) return null;
    } else if (!ignored.has(t)) {
      // rect, par_over, and whatever a later renderer adds.
      return null;
    }
  }
  if (depth !== 0) return null;
  return { kind: "sequence", actors, rows };
}

type StateDb = {
  getData(): {
    nodes: {
      id: string;
      label?: string;
      shape?: string;
      isGroup?: boolean;
      parentId?: string;
      cssClasses?: string;
    }[];
    edges: { start: string; end: string; label?: string; classes?: string }[];
  };
  getDirection(): string | undefined;
};

function isStateDb(db: unknown): db is StateDb {
  if (typeof db !== "object" || db === null) return false;
  const d = db as Record<string, unknown>;
  return ["getData", "getDirection"].every((k) => typeof d[k] === "function");
}

/** The state shapes drawn, as the flow shape they draw as. A choice is a
 * decision with no text: the condition is on the transitions out of it. */
const stateShapes: Record<string, FlowShape> = {
  rect: "step",
  stateStart: "start",
  stateEnd: "stop",
  choice: "decision",
};

/** stateIR reads a state diagram as a flow: a state is a step, `[*]` a
 * start or a stop, a transition an arrow with its event as the label.
 * Composite states, notes, forks and joins and concurrent regions are
 * pictures this does not draw; the renderer does. */
function stateIR(db: unknown): FlowIR | null {
  if (!isStateDb(db)) return null;
  const dir = db.getDirection() ?? "TB";
  if (dir !== "TB" && dir !== "LR") return null;
  const data = db.getData();
  const nodes: FlowNodeIR[] = [];
  const known = new Set<string>();
  for (const n of data.nodes) {
    if (n.isGroup || n.parentId !== undefined) return null;
    const shape = stateShapes[n.shape ?? ""];
    if (shape === undefined) return null;
    if (typeof n.id !== "string" || n.id === "" || known.has(n.id)) continue;
    known.add(n.id);
    const label =
      shape === "start" || shape === "stop" || shape === "decision"
        ? ""
        : unquote(plain(n.label ?? "")) || n.id;
    const node: FlowNodeIR = { id: n.id, label, shape };
    if ((n.cssClasses ?? "").split(/\s+/).includes("focus")) node.focus = true;
    nodes.push(node);
  }
  if (nodes.length === 0) return null;
  const edges: FlowEdgeIR[] = [];
  for (const e of data.edges) {
    if (!known.has(e.start) || !known.has(e.end)) continue;
    edges.push({
      from: e.start,
      to: e.end,
      label: unquote(plain(e.label ?? "")),
      dashed: false,
      head: "end",
    });
  }
  return {
    kind: "flow",
    direction: dir === "LR" ? "LR" : "TB",
    nodes,
    edges,
    zones: [],
  };
}

/** unquote drops a pair of double quotes around a whole state or transition
 * label. The prompt asks for every flowchart label in quotes, where they are
 * syntax, and a model carries the habit into a state diagram, where the
 * grammar takes them as text: every transition read `"URL provided"`. */
function unquote(s: string): string {
  const m = /^"(.*)"$/s.exec(s);
  return m ? m[1] : s;
}

type ErDb = {
  getEntities(): Map<
    string,
    {
      id: string;
      label?: string;
      alias?: string;
      cssClasses?: string;
      attributes?: {
        type?: string;
        name?: string;
        keys?: string[];
        comment?: string;
      }[];
    }
  >;
  getRelationships(): {
    entityA: string;
    entityB: string;
    roleA?: string;
    relSpec?: { cardA?: string; cardB?: string; relType?: string };
  }[];
  getDirection(): string | undefined;
  getSubGraphs?(): unknown[];
};

function isErDb(db: unknown): db is ErDb {
  if (typeof db !== "object" || db === null) return false;
  const d = db as Record<string, unknown>;
  return ["getEntities", "getRelationships", "getDirection"].every(
    (k) => typeof d[k] === "function",
  );
}

const cards: Record<string, Card> = {
  ONLY_ONE: "one",
  ZERO_OR_ONE: "zeroOrOne",
  ONE_OR_MORE: "oneOrMore",
  ZERO_OR_MORE: "zeroOrMore",
};

/** erIR reads an entity model: each entity with its fields, each
 * relationship with its role and the cardinality at either end. A
 * relationship's cardA is the one written at entityB's side (`A ||--o{ B`
 * reads cardA "zero or more", cardB "only one"), so it is drawn at B. An
 * entity related to itself, an unknown cardinality, a direction other than
 * down or right and a subgraph grouping tables are pictures this does not
 * draw. So is a relationship naming anything but an entity: dropped, the
 * picture would leave a relationship out and say nothing. */
function erIR(db: unknown): ERIR | null {
  if (!isErDb(db)) return null;
  const dir = db.getDirection() ?? "TB";
  if (dir !== "TB" && dir !== "LR") return null;
  if ((db.getSubGraphs?.() ?? []).length > 0) return null;
  const entities: EntityIR[] = [];
  const byKey = new Map<string, string>();
  for (const [name, e] of db.getEntities()) {
    if (typeof name !== "string" || name === "") continue;
    byKey.set(e.id, name);
    const entity: EntityIR = {
      id: name,
      label: plain(e.alias ?? "") || plain(e.label ?? "") || name,
      attrs: (e.attributes ?? []).map((a) => ({
        type: plain(a.type ?? ""),
        name: plain(a.name ?? ""),
        keys: a.keys ?? [],
        comment: plain(a.comment ?? ""),
      })),
    };
    if ((e.cssClasses ?? "").split(/\s+/).includes("focus"))
      entity.focus = true;
    entities.push(entity);
  }
  if (entities.length === 0) return null;
  const rels: RelIR[] = [];
  for (const r of db.getRelationships()) {
    const from = byKey.get(r.entityA);
    const to = byKey.get(r.entityB);
    if (from === undefined || to === undefined || from === to) return null;
    const toCard = cards[r.relSpec?.cardA ?? ""];
    const fromCard = cards[r.relSpec?.cardB ?? ""];
    if (toCard === undefined || fromCard === undefined) return null;
    rels.push({
      from,
      to,
      label: plain(r.roleA ?? ""),
      fromCard,
      toCard,
      dashed: r.relSpec?.relType === "NON_IDENTIFYING",
    });
  }
  return {
    kind: "er",
    direction: dir === "LR" ? "LR" : "TB",
    entities,
    rels,
  };
}

/** A mindmap node as the parse leaves it: its text, the class written on
 * the line after it (`:::focus urgent`), its children. Its shape (a number)
 * and its icon are not read: the level says how a node is drawn, and an
 * icon is a font the drawing does not load. */
type MindDbNode = { descr?: string; class?: string; children?: MindDbNode[] };

function isMindDb(db: unknown): db is { getMindmap(): MindDbNode | null } {
  return (
    typeof db === "object" &&
    db !== null &&
    typeof (db as Record<string, unknown>).getMindmap === "function"
  );
}

/** mindmapIR reads a mindmap's tree as written. How deep and how wide it
 * may be is fits()'s question, not this one's. */
function mindmapIR(db: unknown): MindmapIR | null {
  if (!isMindDb(db)) return null;
  const root = db.getMindmap();
  if (root === null || typeof root !== "object") return null;
  const read = (n: MindDbNode): MindNodeIR => {
    const node: MindNodeIR = {
      label: plain(n.descr ?? ""),
      children: (n.children ?? []).map(read),
    };
    if ((n.class ?? "").split(/\s+/).includes("focus")) node.focus = true;
    return node;
  };
  const ir = read(root);
  if (ir.label === "") return null;
  return { kind: "mindmap", root: ir };
}

type TimelineDb = {
  getTasks(): { section?: string; task?: string; events?: string[] }[];
  getCommonDb(): { getDiagramTitle(): string };
};

function isTimelineDb(db: unknown): db is TimelineDb {
  if (typeof db !== "object" || db === null) return false;
  const d = db as Record<string, unknown>;
  return ["getTasks", "getCommonDb"].every((k) => typeof d[k] === "function");
}

/** timelineIR reads a timeline: each period (the renderer's task) with its
 * events, under its section. The source's direction is not read: which
 * way it lies is the width's to say (../timeline.ts). */
function timelineIR(db: unknown): TimelineIR | null {
  if (!isTimelineDb(db)) return null;
  const periods: PeriodIR[] = [];
  for (const t of db.getTasks()) {
    const p: PeriodIR = {
      label: plain(t.task ?? ""),
      events: (t.events ?? []).map(plain).filter((e) => e !== ""),
    };
    const section = plain(t.section ?? "");
    if (section !== "") p.section = section;
    periods.push(p);
  }
  if (periods.length === 0) return null;
  return {
    kind: "timeline",
    title: plain(db.getCommonDb().getDiagramTitle()),
    periods,
  };
}

/** A built quadrant chart: everything placed, in the renderer's pixels. */
type QuadrantData = {
  points: { x: number; y: number; fill?: string; text: { text: string } }[];
  quadrants: {
    x: number;
    y: number;
    width: number;
    height: number;
    text: { text: string };
  }[];
  axisLabels: { text: string; rotation: number }[];
};
type QuadrantDb = {
  getQuadrantData(): QuadrantData;
  addClass(name: string, styles: string[]): void;
  getDiagramTitle(): string;
};

function isQuadrantDb(db: unknown): db is QuadrantDb {
  if (typeof db !== "object" || db === null) return false;
  const d = db as Record<string, unknown>;
  return ["getQuadrantData", "addClass", "getDiagramTitle"].every(
    (k) => typeof d[k] === "function",
  );
}

/** The colour a point of class `focus` takes for the read. The built chart
 * keeps no point's class, only the colour its class gave it, so the class
 * is given this one before the build. The parse is the read's own: a
 * render parses the source again, from scratch. A point's own `color:`
 * outranks its class's, and such a point reads as no focus. */
const focusMark = "#0f0c05";

/** quadrantIR reads a quadrant chart. The renderer keeps its points only as
 * a built chart, in its own pixels, newest first: they are read back to
 * 0..1 against the quadrants' frames and turned round to the order
 * written. Each axis gives the name at its tip (axisName); an axis whose
 * ends name it no way short enough is a picture this does not draw. */
function quadrantIR(db: unknown): QuadrantIR | null {
  if (!isQuadrantDb(db)) return null;
  db.addClass("focus", [`color: ${focusMark}`]);
  const d = db.getQuadrantData();
  // quadrant-1 top right, then counter-clockwise.
  const [q1, , q3] = d.quadrants;
  const left = q3.x;
  const top = q1.y;
  const w = q1.x + q1.width - left;
  const h = q3.y + q3.height - top;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const points: QuadrantPointIR[] = d.points
    .slice()
    .reverse()
    .map((p) => {
      const point: QuadrantPointIR = {
        label: plain(p.text.text),
        x: round((p.x - left) / w),
        y: round(1 - (p.y - top) / h),
      };
      if (p.fill === focusMark) point.focus = true;
      return point;
    });
  // Each axis's texts, low end first: x by rotation 0, y by -90.
  const ends = (rotation: number) =>
    d.axisLabels
      .filter((a) => a.rotation === rotation)
      .map((a) => plain(a.text));
  const xAxis = axisName(ends(0));
  const yAxis = axisName(ends(-90));
  if (xAxis === null || yAxis === null) return null;
  const q = d.quadrants.map((r) => plain(r.text.text));
  return {
    kind: "quadrant",
    title: plain(db.getDiagramTitle()),
    xAxis,
    yAxis,
    quadrants: [q[0], q[1], q[2], q[3]],
    points,
  };
}

/** axisName is the one name an axis takes at its arrow tip, from the texts
 * the source gives its ends (`x-axis Low effort --> High effort`), low end
 * first. A word at the tip, never a phrase and never both ends: the
 * reference draws an axis that way, and a phrase at the tip crowds the
 * frame.
 *
 * - One text names the axis: `x-axis Effort` is "Effort".
 * - Two that differ only in their first word name it by the rest:
 *   `Low effort --> High effort` is "Effort".
 * - Otherwise the high end's text, when it is one concept, at most two
 *   words: `Cheap --> Costly` is "Costly", `Low --> High` is "High".
 * - Otherwise there is no name short enough: null, and the renderer draws
 *   the chart with both ends written out.
 *
 * No text at all is an axis without a name, "". */
export function axisName(ends: string[]): string | null {
  const texts = ends.filter((t) => t !== "");
  if (texts.length === 0) return "";
  if (texts.length === 1) return texts[0];
  const [low, high] = texts;
  const lw = low.split(" ");
  const hw = high.split(" ");
  const rest = hw.slice(1).join(" ");
  if (
    lw.length === hw.length &&
    lw.length > 1 &&
    lw.slice(1).join(" ").toLowerCase() === rest.toLowerCase()
  )
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  return hw.length <= 2 ? high : null;
}

/** lanes reads a flowchart as a swimlane where it is one: left to right,
 * two or more subgraphs, every step in one of them (the renderer's db puts
 * a step in the first subgraph naming it, and only there), and no arrow
 * from a step to itself. Two zones with every arrow from the first into the
 * second are the trigger-to-target mapping instead, which has a layout of
 * its own (isMapping): that is asked first, so a mapping never turns into
 * lanes. Nesting was declined in flowIR already.
 *
 * Subgraphs of one title are one role written twice (a model opening the
 * role's subgraph again for a step late in the flow): one lane, where the
 * role was first written. Drawn apart, the role had two bands and its
 * steps read as two people's.
 *
 * Top-down, the same shape is lanes as bands down the page (bands.ts), if
 * an arrow hands over from one subgraph to another: zones nothing hands
 * between are flows drawn side by side, each in its frame, as they were.
 * So is a top-down flow of more roles than the caps' lanes: as lanes it
 * went to the renderer, as zones it was drawn. Read by laneFlow
 * (../swimlane.ts), as a JSON IR asking for lanes is. */
function lanes(f: FlowIR | null): FlowIR | SwimlaneIR | null {
  if (f === null) return f;
  const l = laneFlow(f, {
    everyZoned: true,
    ...(f.direction === "TB" ? { maxLanes: limits.lanes } : {}),
  });
  // Lanes it cannot make are the flow it was, drawn with zones: never null,
  // which hands the source to the renderer.
  return (l === null ? null : asSwimlane(l)) ?? f;
}

type ClassMember = { text?: string; classifier?: string };
type ClassDb = {
  getClasses(): Map<
    string,
    {
      id: string;
      label?: string;
      text?: string;
      cssClasses?: string;
      members?: ClassMember[];
      methods?: ClassMember[];
      annotations?: string[];
    }
  >;
  getRelations(): {
    id1: string;
    id2: string;
    relation?: { type1?: unknown; type2?: unknown; lineType?: number };
    relationTitle1?: string;
    relationTitle2?: string;
    title?: string;
  }[];
  getNotes(): unknown;
  getNamespaces(): unknown;
  getDirection(): string | undefined;
  getDiagramTitle?(): string;
};

function isClassDb(db: unknown): db is ClassDb {
  if (typeof db !== "object" || db === null) return false;
  const d = db as Record<string, unknown>;
  return [
    "getClasses",
    "getRelations",
    "getNotes",
    "getNamespaces",
    "getDirection",
  ].every((k) => typeof d[k] === "function");
}

/** The renderer's relation types (its relationType table) by the mark they
 * put at their end: 0 aggregation, 1 extension, 2 composition, 3 an
 * arrowhead. 4 is a lollipop, drawn nowhere here. */
const classMarks: Record<number, ClassRelKind> = {
  0: "aggregation",
  1: "inheritance",
  2: "composition",
  3: "association",
};

/** count is how many entries the db holds in a Map, an array or a record:
 * which one it keeps has changed between renderer versions. */
function count(x: unknown): number {
  if (x instanceof Map) return x.size;
  if (Array.isArray(x)) return x.length;
  return typeof x === "object" && x !== null ? Object.keys(x).length : 0;
}

/** member is a field or method as the renderer's own drawing writes it:
 * visibility, name, a method's ` : return`, generics as `<T>`. Its text
 * escapes the visibility mark with a backslash, which no drawing shows. A
 * static member, `$`, is underlined and an abstract one, `*`, set in
 * italics, as UML has them; the mark itself is not text. */
function member(m: ClassMember): ClassMemberIR {
  const out: ClassMemberIR = {
    text: plain((m.text ?? "").replace(/^\\/, "")),
  };
  if (m.classifier === "$") out.static = true;
  if (m.classifier === "*") out.abstract = true;
  return out;
}

/** classIR reads a class diagram: each class with its stereotype, fields
 * and methods, each relationship by the mark at one end. Notes, namespaces,
 * a title, a lollipop interface, a relationship marked at both ends or
 * from a class to itself, and a direction other than down or right are
 * pictures this does not draw; the renderer does. */
function classIR(db: unknown): ClassDiagramIR | null {
  if (!isClassDb(db)) return null;
  const dir = db.getDirection() ?? "TB";
  if (dir !== "TB" && dir !== "LR") return null;
  if (
    count(db.getNotes()) > 0 ||
    count(db.getNamespaces()) > 0 ||
    (db.getDiagramTitle?.() ?? "") !== ""
  )
    return null;
  const classes: ClassIR[] = [];
  for (const [id, c] of db.getClasses()) {
    if (typeof id !== "string" || id === "") continue;
    const k: ClassIR = {
      id,
      // The text carries a generic class's parameter, `Repo<T>`; the label
      // drops it.
      label: plain(c.text ?? "") || plain(c.label ?? "") || id,
      fields: (c.members ?? []).map(member),
      methods: (c.methods ?? []).map(member),
    };
    const stereotype = plain(c.annotations?.[0] ?? "");
    if (stereotype !== "") k.stereotype = stereotype;
    if ((c.cssClasses ?? "").split(/\s+/).includes("focus")) k.focus = true;
    classes.push(k);
  }
  if (classes.length === 0) return null;
  const known = new Set(classes.map((c) => c.id));
  const mark = (t: unknown) =>
    t === undefined || t === "none" ? null : Number(t);
  const card = (s: string | undefined) =>
    s === undefined || s === "none" ? "" : plain(s);
  const rels: ClassRelIR[] = [];
  for (const r of db.getRelations()) {
    if (!known.has(r.id1) || !known.has(r.id2) || r.id1 === r.id2) return null;
    const m1 = mark(r.relation?.type1);
    const m2 = mark(r.relation?.type2);
    if (m1 !== null && m2 !== null) return null;
    // The marked end is `to`: the parent, the whole, the class used.
    const atFirst = m1 !== null;
    const m = atFirst ? m1 : m2;
    const kind = m === null ? "link" : classMarks[m];
    if (kind === undefined) return null;
    rels.push({
      from: atFirst ? r.id2 : r.id1,
      to: atFirst ? r.id1 : r.id2,
      kind,
      dashed: r.relation?.lineType === 1,
      label: plain(r.title ?? ""),
      fromCard: card(atFirst ? r.relationTitle2 : r.relationTitle1),
      toCard: card(atFirst ? r.relationTitle1 : r.relationTitle2),
    });
  }
  return {
    kind: "class",
    direction: dir === "LR" ? "LR" : "TB",
    classes,
    rels,
  };
}

function headOf(type: string): FlowEdgeIR["head"] {
  if (type.startsWith("double_")) return "both";
  if (type === "arrow_open") return "none";
  return "end";
}

/** plain is a label as the reader should see it, as mermaid's own drawing
 * showed it: a line break is a line break, other markup is dropped, the
 * entities the parse left in are decoded, a markdown label loses its
 * backticks and emphasis, and space is collapsed.
 *
 * The parse leaves two layers of escaping. It sanitises node and subgraph
 * text into HTML (`&` arrives as `&amp;`), and it parks the source's own
 * entity codes (`#quot;`, `#35;`) behind private placeholder characters
 * that its drawing turns back into entities on the way out. Drawn as text
 * with neither undone, `Salt & Pepper` read `Salt &amp;amp; Pepper` and a quote
 * read as the placeholder. */
export function plain(s: string): string {
  const html = s
    .replace(/ﬂ°°/g, "&#")
    .replace(/ﬂ°/g, "&")
    .replace(/¶ß/g, ";")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return markdown(decode(html))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l !== "")
    .join("\n");
}

/** decode turns HTML entities into the characters they name. Through a
 * textarea, whose content is never parsed as elements, so nothing in a
 * label can become markup on the way. */
function decode(s: string): string {
  if (!s.includes("&") || typeof document === "undefined") return s;
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

/** markdown drops the markup of a backtick-quoted markdown label, which
 * mermaid draws formatted and this draws as plain text. */
function markdown(s: string): string {
  const m = /^\s*`([\s\S]*)`\s*$/.exec(s);
  if (!m) return s;
  return m[1]
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/(^|\s)_(.+?)_(?=\s|$)/g, "$1$2");
}
