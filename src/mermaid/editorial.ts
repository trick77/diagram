import { toIR } from "./ir";
import { fits, type Limits } from "../fits";
import { drawIR, type Room } from "../render";
import type { DiagramIR } from "../ir";
import { checkIR } from "../check/ir";
import { serial } from "./serial";

/**
 * The package's own drawing of a mermaid source, or null when it has none
 * and the renderer should draw the source as it always did. Loaded by
 * draw.ts on the first fence, as its own chunk. The layout engine is a
 * chunk of its own again (../render.ts engine), loaded on the first flow
 * or entity model that needs it: it is large, and a sequence never uses it.
 */

/** The part of the renderer this reads: its parse, as a type and a db. */
export type Parser = {
  mermaidAPI: {
    getDiagramFromText(src: string): Promise<{ type: string; db: unknown }>;
  };
};

/** room is where the drawing is shown (../render.ts Room). */
export async function editorial(
  mermaid: Parser,
  src: string,
  ids: string,
  limits?: Partial<Limits>,
  room: Room = {},
): Promise<string | null> {
  const ir = await read(mermaid, src);
  if (ir === null || !fits(ir, limits)) return null;
  const { svg, laid } = await drawIR(ir, ids, { width: room.width });
  // A drawing that breaks the package's own rules (edges crossing, a line
  // behind a box) is not handed out: the renderer draws the source, as for
  // one past the caps. Dense state graphs did, 2 to 5 crossings each, with
  // every layout the engine offered. Checked as drawn: a timeline the way
  // its room laid it, nothing laid out a second time.
  const broken = await checkIR(ir, { layout: laid });
  return broken.length === 0 ? svg : null;
}

/** read parses a source and reads its db, one source at a time, in the
 * chain the renderer's own parse and render share (serial.ts): two fences
 * parsed together, the second parse landed between the first's parse and
 * its read, and both drew the second's picture. */
function read(mermaid: Parser, src: string): Promise<DiagramIR | null> {
  return serial(async () => {
    const d = await mermaid.mermaidAPI.getDiagramFromText(src);
    return toIR(d.type, d.db);
  });
}
