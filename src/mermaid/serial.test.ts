import { describe, it, expect, vi } from "vitest";

// The renderer keeps one db for every timeline on the page (one builder for
// every quadrant chart): whatever parsed last is what the next render or
// read sees. The stand-in records which source each call parsed, and a
// render checks the last parse was its own source. Every call takes a tick,
// as the real ones do.
let parsed = "";
const renderedOther: string[] = [];
const tick = () => new Promise((r) => setTimeout(r, 1));
vi.mock("mermaid", () => ({
  default: {
    initialize: () => {},
    parse: async (src: string) => {
      parsed = src;
      await tick();
      return {};
    },
    render: async (_id: string, src: string) => {
      await tick();
      if (parsed !== src) renderedOther.push(src);
      return { svg: `<svg data-src="${src.length}"></svg>` };
    },
    mermaidAPI: {
      // The package's own read: it declines both (past the caps), so both
      // go on to the renderer.
      getDiagramFromText: async (src: string) => {
        parsed = src;
        await tick();
        return { type: "unknown", db: {} };
      },
    },
  },
}));

import { draw } from "./draw";

describe("the renderer's single db", () => {
  it("is never parsed by one fence between another's parse and render", async () => {
    const a = "timeline\n  title past caps a\n  2024 : one";
    const b = "timeline\n  title past caps b\n  2025 : two";
    const [da, db] = await Promise.all([draw(a), draw(b)]);
    expect(da).toEqual({ svg: `<svg data-src="${a.length}"></svg>` });
    expect(db).toEqual({ svg: `<svg data-src="${b.length}"></svg>` });
    expect(renderedOther).toEqual([]);
  });
});
