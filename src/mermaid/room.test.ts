import { describe, it, expect, vi, beforeEach } from "vitest";

// draw() for a drawing whose way depends on its room: the renderer and the
// own drawing stand in, as in draw.test.ts, and the own one answers like a
// timeline, flat at or past 900px.
const render = vi.fn(async (_id: string, _src: string) => ({
  svg: "<svg data-renderer></svg>",
}));
vi.mock("mermaid", () => ({
  default: {
    initialize: () => {},
    parse: async () => ({}),
    render: (i: string, s: string) => render(i, s),
  },
}));
const timeline = (width?: number) =>
  width !== undefined && width >= 900
    ? '<svg data-orient="horizontal" data-wide="900"></svg>'
    : '<svg data-orient="vertical" data-wide="900"></svg>';
const editorial = vi.fn(
  async (
    _m: unknown,
    src: string,
    _ids: string,
    _limits: unknown,
    room: { width?: number },
  ): Promise<string | null> =>
    // A timeline past the caps: declined, the renderer draws it.
    src.includes("past caps")
      ? null
      : src.startsWith("timeline")
        ? timeline(room.width)
        : "<svg data-flow></svg>",
);
vi.mock("./editorial", () => ({
  editorial: (
    m: unknown,
    s: string,
    i: string,
    l: unknown,
    r: { width?: number },
  ) => editorial(m, s, i, l, r),
}));

import { draw } from "./draw";

beforeEach(() => {
  editorial.mockClear();
});

const room = () => editorial.mock.calls.map((c) => c[4].width);

describe("draw in a room", () => {
  // The renderer's timeline is the same in any room: every new width cost a
  // full render once the own drawing had declined it.
  it("draws a timeline the renderer draws once, whatever the width", async () => {
    const src = "timeline\n title past caps\n c : three";
    render.mockClear();
    const a = await draw(src, { width: 700 });
    expect(a).toEqual({ svg: "<svg data-renderer></svg>" });
    await draw(src, { width: 800 });
    await draw(src, { width: 1200 });
    await draw(src);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("hands the width to the own drawing", async () => {
    const out = await draw("timeline\n a : one", { width: 1200 });
    expect(out).toEqual({ svg: timeline(1200), own: true });
    expect(room()).toEqual([1200]);
  });

  it("draws a timeline again only when the width crosses where it lies flat", async () => {
    const src = "timeline\n b : two";
    await draw(src, { width: 700 });
    await draw(src, { width: 701 });
    await draw(src, { width: 899 });
    // Standing is also the drawing without a width.
    await draw(src);
    expect(room()).toEqual([700]);
    await draw(src, { width: 900 });
    await draw(src, { width: 1400 });
    expect(room()).toEqual([700, 900]);
    expect(await draw(src, { width: 1000 })).toEqual({
      svg: timeline(1000),
      own: true,
    });
  });

  it("takes a width of 0, not measured yet, for none", async () => {
    await draw("timeline\n c : three", { width: 0 });
    expect(room()).toEqual([undefined]);
  });

  it("draws any other kind once, whatever the width", async () => {
    const src = "flowchart TD\n a --> b";
    await draw(src, { width: 700 });
    await draw(src, { width: 1400 });
    await draw(src);
    expect(editorial).toHaveBeenCalledTimes(1);
  });
});
