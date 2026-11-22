import { beforeAll, describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";

// The checks editorial asks for, recorded: what it checks must be what it
// drew, and nothing laid out a second time to check it.
const checked = vi.hoisted(() => [] as { layout?: unknown }[]);
vi.mock("../check/ir", async (original) => {
  const real = await original<typeof import("../check/ir")>();
  return {
    ...real,
    checkIR: (ir: unknown, opts: { layout?: unknown } = {}) => {
      checked.push(opts);
      return real.checkIR(ir as never, opts as never);
    },
  };
});

import { editorial } from "./editorial";
import { engine } from "../render";

const sources: Record<string, string> = import.meta.glob(
  "../../testdata/diagrams/*.mmd",
  { query: "?raw", import: "default", eager: true },
);
const corpus = (name: string) =>
  sources[`../../testdata/diagrams/${name}`].trimEnd();

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
});

describe("editorial's check", () => {
  // Checked both ways, a timeline clean the way it was drawn could be
  // refused for the way it was not, and its source then handed to the
  // renderer for every room.
  it("checks a timeline the way it was drawn", async () => {
    for (const width of [400, 2000]) {
      checked.length = 0;
      const svg = await editorial(
        mermaid,
        corpus("timeline-five.mmd"),
        "t",
        {},
        {
          width,
        },
      );
      expect(svg).toMatch(/^<svg /);
      const orient = svg!.includes('data-orient="horizontal"')
        ? "horizontal"
        : "vertical";
      expect(checked).toHaveLength(1);
      expect(checked[0].layout).toMatchObject({ orient });
    }
  });

  // The engine is the slow part: an entity model or a class diagram was
  // laid out once to draw and once more to check.
  it("lays an entity model and a class diagram out once", async () => {
    const elk = await engine();
    const layout = vi.spyOn(elk, "layout");
    for (const name of ["er-model.mmd", "class-interface.mmd"]) {
      layout.mockClear();
      checked.length = 0;
      expect(await editorial(mermaid, corpus(name), "t")).toMatch(/^<svg /);
      expect(layout, name).toHaveBeenCalledTimes(1);
      expect(checked[0].layout, name).toBeDefined();
    }
    layout.mockRestore();
  });
});
