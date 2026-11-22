import { toIR } from "./ir";
import { fits, type Limits } from "../fits";
import { drawIR, type Room } from "../render";
import type { DiagramIR } from "../ir";
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
  return (await drawIR(ir, ids, { width: room.width })).svg;
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
