import type { FlowIR } from "./ir";
import {
  isMapping,
  layoutElk,
  layoutFlow,
  type Elk,
  type FlowLayout,
  type FlowOptions,
} from "./layout";
import { check } from "./check/check";

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
 */
export async function layoutFlowChecked(
  ir: FlowIR,
  elk: () => Promise<Elk>,
  opts: FlowOptions = {},
): Promise<FlowLayout> {
  const first = await layoutFlow(ir, elk, opts);
  if (isMapping(ir)) return first;
  const bad = check(first).length;
  if (bad === 0) return first;
  const free = await layoutElk(ir, await elk(), true);
  return check(free).length < bad ? free : first;
}
