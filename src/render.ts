import type { DiagramIR } from "./ir";
import type { Elk, FlowLayout, FlowOptions } from "./layout";
import { layoutFlowChecked, layoutSwimlaneChecked } from "./flowfit";
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
import { layoutClass, type ClassLayout } from "./class";
import { layoutER, type ERLayout } from "./er";
import { layoutMindmap, type MindmapLayout } from "./mindmap";
import { layoutSequence, type SequenceLayout } from "./sequence";
import type { SwimlaneLayout } from "./swimlane";
import { palette, type Palette } from "./theme";
import { layoutTimeline, type TimelineLayout } from "./timeline";
import { layoutQuadrant, type QuadrantLayout } from "./quadrant";

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

/** Any kind's layout. */
export type AnyLayout =
  | FlowLayout
  | SequenceLayout
  | ERLayout
  | MindmapLayout
  | TimelineLayout
  | QuadrantLayout
  | SwimlaneLayout
  | ClassLayout;

/** A drawing, and the flow layout it came from: a consumer lays links over
 * the nodes by their boxes (almanach's maps); a swimlane's is a flow layout
 * with its lanes. null for any other kind. laid is the layout drawn, every
 * kind's: checkIR holds it to the rules without laying it out again. */
export type Rendered = {
  svg: string;
  layout: FlowLayout | null;
  laid: AnyLayout;
};

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
  if (ir.kind === "timeline") {
    const laid = layoutTimeline(ir, opts.width);
    return { svg: drawTimeline(laid, pal), layout: null, laid };
  }
  if (ir.kind === "quadrant") {
    const laid = layoutQuadrant(ir);
    return { svg: drawQuadrant(laid, pal, ids), layout: null, laid };
  }
  if (ir.kind === "sequence") {
    const laid = layoutSequence(ir);
    return { svg: drawSequence(laid, pal, ids), layout: null, laid };
  }
  if (ir.kind === "er") {
    const laid = await layoutER(ir, await engine());
    return { svg: drawER(laid, pal), layout: null, laid };
  }
  if (ir.kind === "mindmap") {
    const laid = layoutMindmap(ir);
    return { svg: drawMindmap(laid, pal), layout: null, laid };
  }
  if (ir.kind === "class") {
    const laid = await layoutClass(ir, await engine());
    return { svg: drawClass(laid, pal), layout: null, laid };
  }
  // A swimlane in its lanes, left to right by code and top-down in bands;
  // one its lanes cannot route, or route only breaking more rules, as the
  // flow it was written as, its lanes as zones (layoutSwimlaneChecked).
  const layout =
    ir.kind === "swimlane"
      ? await layoutSwimlaneChecked(ir, engine, {
          tree: opts.tree,
          bandOrder: opts.bandOrder,
        })
      : await layoutFlowChecked(ir, engine, {
          tree: opts.tree,
          lanes: opts.lanes,
          bandOrder: opts.bandOrder,
        });
  const svg =
    "lanes" in layout
      ? drawSwimlane(layout as SwimlaneLayout, pal, ids)
      : drawFlow(layout, pal, ids);
  return { svg, layout, laid: layout };
}
