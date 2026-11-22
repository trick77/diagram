import type { FlowIR, SwimlaneIR } from "./ir";
import {
  isMapping,
  layoutElk,
  layoutFlow,
  type Elk,
  type FlowLayout,
  type FlowOptions,
} from "./layout";
import { check, checkSwimlane } from "./check/check";
import { layoutBands } from "./bands";
import {
  asFlow,
  asSwimlane,
  laneFlow,
  laneOrder,
  layoutSwimlane,
  type SwimlaneLayout,
} from "./swimlane";

/**
 * layoutFlowChecked is layoutFlow held to the connector rules (check): a
 * layout that breaks them is laid out once more by the engine, free to
 * reorder a rank against the order written, and the one with fewer
 * problems is kept, the first on a tie. The first is the spine, the org
 * chart or the engine in the order written, whichever layoutFlow picks:
 * each keeps a flow's steps where the source put them. Written order
 * crossed two branches merging into one end node, which the engine drew
 * apart once free of it. A mapping keeps its two columns in the order
 * written by design and is not laid out again. What still breaks a rule is
 * the caller's to judge: ./mermaid hands it to the renderer (editorial.ts).
 *
 * Asked for lanes, a flow with zones is laid out in them (lanesOf); one
 * they decline is laid out as any other flow, and so is one its lanes
 * break more rules for than its zones do (fewerBreaks).
 */
export async function layoutFlowChecked(
  ir: FlowIR,
  elk: () => Promise<Elk>,
  opts: FlowOptions = {},
): Promise<FlowLayout> {
  if (opts.lanes) {
    const lanes = await lanesOf(ir, elk, opts.bandOrder);
    if (lanes)
      return fewerBreaks(
        lanes,
        () => layoutFlowChecked(ir, elk, { ...opts, lanes: false }),
        isMapping(ir),
      );
  }
  const first = await layoutFlow(ir, elk, opts);
  if (isMapping(ir)) return first;
  const bad = check(first).length;
  if (bad === 0) return first;
  const free = await layoutElk(ir, await elk(), true);
  return check(free).length < bad ? free : first;
}

/** layoutSwimlaneChecked lays a swimlane out in its lanes: left to right
 * by code, top-down in bands. Lanes it declines, or that break more rules
 * than the flow it was written as, give way to that flow, its lanes as
 * zones. drawIR draws this and checkIR checks it. */
export async function layoutSwimlaneChecked(
  ir: SwimlaneIR,
  elk: () => Promise<Elk>,
  opts: FlowOptions = {},
): Promise<FlowLayout> {
  const f = asFlow(ir);
  const flow = () => layoutFlowChecked(f, elk, { tree: opts.tree });
  const lanes =
    ir.direction === "TB"
      ? await layoutBands(f, await elk(), laneOrder(f, opts.bandOrder ?? []))
      : layoutSwimlane(ir);
  return lanes ? fewerBreaks(lanes, flow, isMapping(asFlow(ir))) : flow();
}

/** fewerBreaks is the lanes, or the flow where the lanes break a rule and
 * the flow breaks fewer: lanes the rules refuse are no reason to draw a
 * zoned flow any worse than the flow layouts would. A tie keeps the lanes. */
async function fewerBreaks(
  lanes: SwimlaneLayout,
  flow: () => Promise<FlowLayout>,
  written: boolean,
): Promise<FlowLayout> {
  const bad = checkSwimlane(lanes).length;
  if (bad === 0) return lanes;
  const f = await flow();
  return check(f, { written }).length < bad ? f : lanes;
}

/** lanesOf is a zoned flow in lanes, as laneFlow (./swimlane.ts) reads
 * one: top-down, its zones as bands down the page in the order asked, the
 * steps of no zone in a last band; left to right with every step in a
 * zone, as a swimlane. null for a flow that is no lanes, or one neither
 * lays out. The order names zones as the IR does; one merged into another's
 * lane stands for that lane (laneOrder). */
export async function lanesOf(
  ir: FlowIR,
  elk: () => Promise<Elk>,
  order: string[] = [],
): Promise<SwimlaneLayout | null> {
  const tb = ir.direction === "TB";
  const l = laneFlow(ir, { everyZoned: !tb });
  if (l === null) return null;
  if (tb) return layoutBands(l, await elk(), laneOrder(ir, order));
  const s = asSwimlane(l);
  return s ? layoutSwimlane(s) : null;
}
