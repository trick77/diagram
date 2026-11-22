import type { DiagramIR } from "../ir";
import { isMapping, type FlowLayout } from "../layout";
import { layoutFlowChecked, layoutSwimlaneChecked } from "../flowfit";
import { layoutSequence, type SequenceLayout } from "../sequence";
import { layoutER, type ERLayout } from "../er";
import { layoutMindmap, type MindmapLayout } from "../mindmap";
import { layoutTimeline, type TimelineLayout } from "../timeline";
import { layoutQuadrant, type QuadrantLayout } from "../quadrant";
import { asFlow, type SwimlaneLayout } from "../swimlane";
import { layoutClass, type ClassLayout } from "../class";
import { engine, type AnyLayout } from "../render";
import {
  check,
  checkClass,
  checkER,
  checkMindmap,
  checkSequence,
  checkSwimlane,
} from "./check";
import { checkQuadrant, checkTimeline } from "./plot";

export type { AnyLayout };

export type CheckIROptions = {
  /** The layout to check, the IR's kind's; laid out here when absent. */
  layout?: AnyLayout;
  /** As drawIR takes it: false keeps a top-down tree off the org chart. */
  tree?: boolean;
  /** As drawIR takes them: a flow with zones laid out in lanes, its bands
   * in this order. */
  lanes?: boolean;
  bandOrder?: string[];
};

/** checkIR holds a diagram to the layout rules of its kind, laid out as
 * drawIR lays it out: the one switch over every kind, so a consumer's corpus
 * test keeps none of its own. A timeline is checked standing and, where it
 * ever lies flat, flat; a swimlane its lanes decline, as the flow it is then
 * drawn as. Returns what is wrong, in words, empty when nothing is. */
export async function checkIR(
  ir: DiagramIR,
  opts: CheckIROptions = {},
): Promise<string[]> {
  const given = opts.layout;
  switch (ir.kind) {
    case "sequence":
      return checkSequence(
        (given as SequenceLayout | undefined) ?? layoutSequence(ir),
      );
    case "er":
      return checkER(
        (given as ERLayout | undefined) ?? (await layoutER(ir, await engine())),
      );
    case "mindmap":
      return checkMindmap(
        (given as MindmapLayout | undefined) ?? layoutMindmap(ir),
      );
    case "timeline": {
      if (given) return checkTimeline(given as TimelineLayout);
      const up = layoutTimeline(ir);
      return [
        ...checkTimeline(up),
        ...checkTimeline(layoutTimeline(ir, up.wide)),
      ];
    }
    case "quadrant":
      return checkQuadrant(
        (given as QuadrantLayout | undefined) ?? layoutQuadrant(ir),
      );
    case "class":
      return checkClass(
        (given as ClassLayout | undefined) ??
          (await layoutClass(ir, await engine())),
      );
    case "swimlane": {
      // A layout handed in is lanes only if it has them: drawIR hands back
      // the flow layout of a swimlane its lanes declined.
      const flow = asFlow(ir);
      const l =
        (given as FlowLayout | undefined) ??
        (await layoutSwimlaneChecked(ir, engine, {
          tree: opts.tree,
          bandOrder: opts.bandOrder,
        }));
      if ("lanes" in l) return checkSwimlane(l as SwimlaneLayout);
      return check(l, { written: isMapping(flow) });
    }
    case "flow": {
      const l =
        (given as FlowLayout | undefined) ??
        (await layoutFlowChecked(ir, engine, {
          tree: opts.tree,
          lanes: opts.lanes,
          bandOrder: opts.bandOrder,
        }));
      if ("lanes" in l) return checkSwimlane(l as SwimlaneLayout);
      return check(l, { written: isMapping(ir) });
    }
  }
}
