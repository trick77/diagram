import type { DiagramIR } from "./ir";
import {
  layoutFlow,
  type Elk,
  type FlowLayout,
  type FlowOptions,
} from "./layout";
import {
  drawClass,
  drawER,
  drawFlow,
  drawMindmap,
  drawQuadrant,
  drawSequence,
  drawSwimlane,
  drawTimeline,
} from "./draw";
import { layoutClass } from "./class";
import { layoutER } from "./er";
import { layoutMindmap } from "./mindmap";
import { layoutSequence } from "./sequence";
import { asFlow, layoutSwimlane } from "./swimlane";
import { palette, type Palette } from "./theme";
import { layoutTimeline } from "./timeline";
import { layoutQuadrant } from "./quadrant";

/**
 * A diagram's IR laid out and written as SVG: the glue every consumer had a
 * copy of. A sequence, a mindmap, a timeline and a quadrant are laid out by
 * code; a mapping, a spine and a swimlane too; only a flow nothing simpler
 * fits, an entity model and a class diagram ask for the layout engine.
 */

/** The layout engine is its own chunk, loaded on the first flow, entity
 * model or class diagram that needs it: it is large, and a sequence never
 * uses it. One promise, so two diagrams arriving together load it once. */
let elk: Promise<Elk> | null = null;
export function engine(): Promise<Elk> {
  elk ??= import("elkjs/lib/elk.bundled.js").then(
    (m) => new m.default(),
    (e: unknown) => {
      // A chunk gone after a redeploy is tried again by the next diagram.
      elk = null;
      throw e;
    },
  );
  return elk;
}

/** A drawing, and the flow layout it came from: a consumer lays links over
 * the nodes by their boxes (almanach's maps); a swimlane's is a flow layout
 * with its lanes. null for any other kind. */
export type Rendered = { svg: string; layout: FlowLayout | null };

/** Where a drawing is shown. width is the room it has, in px: a timeline
 * lies flat in it when it fits and stands up otherwise (../timeline.ts).
 * Unknown, it stands up. */
export type Room = { width?: number };

/** How drawIR draws: the palette, read off the document (the --diagram-*
 * tokens) unless one is passed, how a flow is laid out, and the room the
 * drawing is shown in. */
export type DrawIROptions = FlowOptions & Room & { palette?: Palette };

/** drawIR lays a diagram out and writes it as SVG. ids prefixes the marker
 * ids: two drawings on one page must not share one. */
export async function drawIR(
  ir: DiagramIR,
  ids: string,
  opts: DrawIROptions = {},
): Promise<Rendered> {
  const pal = opts.palette ?? palette();
  if (ir.kind === "timeline")
    return {
      svg: drawTimeline(layoutTimeline(ir, opts.width), pal),
      layout: null,
    };
  if (ir.kind === "quadrant")
    return { svg: drawQuadrant(layoutQuadrant(ir), pal, ids), layout: null };
  if (ir.kind === "sequence")
    return { svg: drawSequence(layoutSequence(ir), pal, ids), layout: null };
  if (ir.kind === "er")
    return {
      svg: drawER(await layoutER(ir, await engine()), pal),
      layout: null,
    };
  if (ir.kind === "mindmap")
    return { svg: drawMindmap(layoutMindmap(ir), pal), layout: null };
  if (ir.kind === "class")
    return {
      svg: drawClass(await layoutClass(ir, await engine()), pal),
      layout: null,
    };
  if (ir.kind === "swimlane") {
    // Laid out by code. A shape its connectors cannot route cleanly is
    // drawn as the flow it was written as, its lanes as zones.
    const lanes = layoutSwimlane(ir);
    if (lanes) return { svg: drawSwimlane(lanes, pal, ids), layout: lanes };
  }
  const layout = await layoutFlow(
    ir.kind === "swimlane" ? asFlow(ir) : ir,
    engine,
    { tree: opts.tree },
  );
  return { svg: drawFlow(layout, pal, ids), layout };
}
