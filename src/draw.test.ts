import { describe, it, expect } from "vitest";
import { drawFlow, drawSequence, route, shorten } from "./draw";
import type { SeqRow } from "./ir";
import type { FlowLayout, LabelBox, NodeBox } from "./layout";
import { layoutSequence } from "./sequence";
import type { Palette } from "./theme";

const pal: Palette = {
  surface: "#151514",
  fg: "#ece8df",
  muted: "#a29e94",
  line: "#3b3935",
  tint: "#201f1c",
  accent: "#d97757",
  warn: "#e3a33f",
  sans: "Plex Sans",
  mono: "Plex Mono",
};

const node = (over: Partial<NodeBox>): NodeBox => ({
  id: "a",
  kind: "step",
  lines: ["Gather"],
  face: "sans",
  size: 13,
  bold: false,
  focus: false,
  x: 24,
  y: 24,
  w: 200,
  h: 40,
  ...over,
});

const layout = (over: Partial<FlowLayout> = {}): FlowLayout => ({
  width: 400,
  height: 200,
  nodes: [node({})],
  edges: [],
  zones: [],
  ...over,
});

/** The connectors: paths drawn as lines, not a marker's head or a filled
 * shape. */
const lines = 'svg > path[fill="none"]';

const parse = (svg: string) =>
  new DOMParser().parseFromString(svg, "image/svg+xml");

describe("drawFlow", () => {
  it("writes a standalone SVG at its own size on a canvas of its own", () => {
    const doc = parse(drawFlow(layout(), pal, "t"));
    const svg = doc.documentElement;
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 200");
    expect(svg.getAttribute("width")).toBe("400");
    const canvas = svg.querySelector("rect");
    expect(canvas?.getAttribute("fill")).toBe(pal.surface);
    expect(doc.querySelector("parsererror")).toBeNull();
  });

  it("lays the drawing on its ground with no line round it", () => {
    const doc = parse(drawFlow(layout(), pal, "t"));
    const canvas = doc.documentElement.querySelector("rect")!;
    expect(canvas.getAttribute("stroke")).toBeNull();
    expect(canvas.getAttribute("width")).toBe("400");
    expect(canvas.getAttribute("height")).toBe("200");
  });

  it("writes model text as text, whatever it holds", () => {
    const svg = drawFlow(
      layout({
        nodes: [node({ lines: ['</text><script>alert("x")</script>'] })],
      }),
      pal,
      "t",
    );
    const doc = parse(svg);
    expect(doc.querySelector("script")).toBeNull();
    expect(
      [...doc.querySelectorAll("text")].map((t) => t.textContent),
    ).toContain('</text><script>alert("x")</script>');
  });

  it("frames the focus in the accent over a tint of it", () => {
    const doc = parse(
      drawFlow(layout({ nodes: [node({ focus: true })] }), pal, "t"),
    );
    const frame = [...doc.querySelectorAll("rect")].slice(-1)[0];
    expect(frame.getAttribute("stroke")).toBe(pal.accent);
    expect(frame.getAttribute("stroke-width")).toBe("1.4");
    // 11% of the accent over the surface.
    expect(frame.getAttribute("fill")).toBe("#2b201b");
  });

  it("frames a step and a decision firmer than the line, as strong as the arrows ask", () => {
    const doc = parse(
      drawFlow(
        layout({
          nodes: [node({}), node({ id: "d", kind: "decision", y: 100, h: 52 })],
        }),
        pal,
        "t",
      ),
    );
    const step = [...doc.querySelectorAll("rect")].slice(-1)[0];
    expect(step.getAttribute("stroke")).toBe("#76746f");
    expect(doc.querySelector("polygon")!.getAttribute("stroke")).toBe(
      "#76746f",
    );
  });

  it("draws a start or an end as a pill in the tint, framed firm enough to stand in a lane", () => {
    const doc = parse(
      drawFlow(layout({ nodes: [node({ kind: "pill" })] }), pal, "t"),
    );
    const pill = [...doc.querySelectorAll("rect")].slice(-1)[0];
    expect(pill.getAttribute("rx")).toBe("20");
    expect(pill.getAttribute("fill")).toBe(pal.tint);
    // A lane is in the tint too: in the line colour the pill dissolved.
    expect(pill.getAttribute("stroke")).toBe("#76746f");
  });

  it("keeps the focus at twice the weight where the palette cannot be mixed", () => {
    const vars = { ...pal, accent: "var(--a)", surface: "var(--s)" };
    const doc = parse(
      drawFlow(layout({ nodes: [node({ focus: true })] }), vars, "t"),
    );
    const frame = [...doc.querySelectorAll("rect")].slice(-1)[0];
    expect(frame.getAttribute("stroke-width")).toBe("2");
    expect(frame.getAttribute("fill")).toBe("var(--s)");
  });

  it("draws an outcome in the tint, read from its left edge, and a decision as a diamond", () => {
    const doc = parse(
      drawFlow(
        layout({
          nodes: [
            node({ id: "o", kind: "outcome" }),
            node({ id: "d", kind: "decision", y: 100, h: 52 }),
          ],
        }),
        pal,
        "t",
      ),
    );
    const rects = [...doc.querySelectorAll("rect")];
    expect(rects.slice(-1)[0].getAttribute("fill")).toBe(pal.tint);
    expect(doc.querySelector("text")!.getAttribute("text-anchor")).toBe(
      "start",
    );
    expect(doc.querySelector("polygon")).not.toBeNull();
  });

  it("draws a dotted arrow in the boundary amber with its own head, and a loop dashed in the muted", () => {
    const doc = parse(
      drawFlow(
        layout({
          edges: [
            {
              from: "a",
              to: "b",
              points: [
                { x: 0, y: 0 },
                { x: 0, y: 40 },
              ],
              dashed: true,
              warn: true,
              head: "end",
              label: { lines: ["async"], x: 8, y: 10, w: 40, h: 15 },
            },
            {
              from: "b",
              to: "a",
              points: [
                { x: 50, y: 40 },
                { x: 50, y: 0 },
              ],
              dashed: true,
              warn: false,
              head: "end",
            },
          ],
        }),
        pal,
        "t",
      ),
    );
    const [warn, loop] = [...doc.querySelectorAll(lines)];
    expect(warn.getAttribute("stroke")).toBe(pal.warn);
    expect(warn.getAttribute("marker-end")).toBe("url(#t-warn)");
    expect(loop.getAttribute("stroke")).toBe(pal.muted);
    expect(loop.getAttribute("stroke-dasharray")).toBe("5 4");
    const label = [...doc.querySelectorAll("text")].find(
      (t) => t.textContent === "async",
    )!;
    expect(label.getAttribute("fill")).toBe(pal.warn);
  });

  it("stands a lane label on end", () => {
    const doc = parse(
      drawFlow(
        layout({
          edges: [
            {
              from: "a",
              to: "b",
              points: [
                { x: 0, y: 0 },
                { x: 0, y: 100 },
              ],
              dashed: false,
              warn: false,
              head: "both",
              label: {
                lines: ["red"],
                x: 8,
                y: 30,
                w: 15,
                h: 40,
                vertical: true,
              },
            },
          ],
        }),
        pal,
        "t",
      ),
    );
    const t = [...doc.querySelectorAll("text")].find(
      (x) => x.textContent === "red",
    )!;
    expect(t.getAttribute("transform")).toMatch(/^rotate\(-90 /);
    expect(doc.querySelector(lines)!.getAttribute("marker-start")).toBe(
      "url(#t-arrow)",
    );
  });
});

describe("drawFlow's arrow labels", () => {
  const withLabel = (label: Partial<LabelBox>) =>
    parse(
      drawFlow(
        layout({
          edges: [
            {
              from: "a",
              to: "b",
              points: [
                { x: 0, y: 0 },
                { x: 0, y: 40 },
              ],
              dashed: false,
              warn: false,
              head: "end",
              label: { lines: ["YES"], x: 8, y: 10, w: 20, h: 15, ...label },
            },
          ],
        }),
        pal,
        "t",
      ),
    ).querySelector("text")!;

  it("sets a label at its box's size and tracking", () => {
    const t = withLabel({ size: 10, track: 0.08 });
    expect(t.getAttribute("font-size")).toBe("10");
    expect(t.getAttribute("letter-spacing")).toBe("0.08em");
  });

  it("draws a box a consumer laid out without them as it always did", () => {
    const t = withLabel({});
    expect(t.getAttribute("font-size")).toBe("11.5");
    expect(t.getAttribute("letter-spacing")).toBeNull();
  });
});

describe("route", () => {
  it("joins two runs with a quarter arc of 8px", () => {
    expect(
      route([
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 40, y: 40 },
      ]),
    ).toBe("M0,0 L0,32 Q0,40 8,40 L40,40");
  });

  it("leaves a straight line straight", () => {
    expect(
      route([
        { x: 0, y: 0 },
        { x: 0, y: 40 },
      ]),
    ).toBe("M0,0 L0,40");
  });

  it("shares a short run between its two bends", () => {
    expect(
      route([
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 10, y: 40 },
        { x: 10, y: 80 },
      ]),
    ).toBe("M0,0 L0,35 Q0,40 5,40 L5,40 Q10,40 10,45 L10,80");
  });

  it("keeps an end straight for the head or mark that sits there", () => {
    expect(
      route(
        [
          { x: 0, y: 0 },
          { x: 0, y: 40 },
          { x: 16, y: 40 },
        ],
        8,
        [0, 10],
      ),
    ).toBe("M0,0 L0,34 Q0,40 6,40 L16,40");
  });

  it("bends sharp rather than with an arc under half the radius", () => {
    // Beside 8px corners a 2px one read as a mistake.
    expect(
      route(
        [
          { x: 0, y: 0 },
          { x: 0, y: 40 },
          { x: 12, y: 40 },
        ],
        8,
        [0, 10],
      ),
    ).toBe("M0,0 L0,40 L12,40");
  });

  it("draws nothing for a route with no points, rather than throw", () => {
    expect(route([])).toBe("");
    expect(shorten([], false, 4)).toEqual([]);
  });

  it("draws a bent arrow with its corner rounded", () => {
    const doc = parse(
      drawFlow(
        layout({
          edges: [
            {
              from: "a",
              to: "b",
              points: [
                { x: 0, y: 0 },
                { x: 0, y: 60 },
                { x: 80, y: 60 },
              ],
              dashed: false,
              warn: false,
              head: "end",
            },
          ],
        }),
        pal,
        "t",
      ),
    );
    const d = doc.querySelector('svg > path[fill="none"]')!.getAttribute("d");
    expect(d).toBe("M0,0 L0,52 Q0,60 8,60 L76,60");
  });
});

describe("shorten", () => {
  it("pulls an end back along its last segment, never past its start", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 20 },
    ];
    expect(shorten(pts, false, 4).slice(-1)[0]).toEqual({ x: 0, y: 16 });
    expect(shorten(pts, true, 4)[0]).toEqual({ x: 0, y: 4 });
    expect(shorten(pts, false, 40)).toEqual(pts);
  });
});

describe("drawSequence", () => {
  const seqLayout = () =>
    layoutSequence({
      kind: "sequence",
      actors: [
        { id: "a", label: "Checkout" },
        { id: "b", label: "payments" },
        { id: "c", label: '</text><script>alert("x")</script>' },
      ],
      rows: [
        { type: "frame", keyword: "alt", label: "nothing delivered" },
        msg("a", "c", "call"),
        { type: "divider", keyword: "else", label: "delivered" },
        msg("c", "a", "reply", { line: "dashed" }),
        { type: "end" },
        msg("a", "b", "async", { head: "open" }),
        msg("a", "b", "lost", { head: "cross" }),
        msg("a", "b", "", { head: "none" }),
        msg("b", "b", "self"),
        { type: "note", from: "a", to: "b", side: "over", label: "a note" },
      ],
    });

  it("writes a standalone SVG at its own size, model text as text", () => {
    const l = seqLayout();
    const doc = parse(drawSequence(l, pal, "s"));
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.getAttribute("viewBox")).toBe(
      `0 0 ${l.width} ${l.height}`,
    );
    expect(doc.querySelector("script")).toBeNull();
    expect(
      [...doc.querySelectorAll("text")].map((t) => t.textContent),
    ).toContain('</text><script>alert("x")</script>');
  });

  it("dashes lifelines and replies, and ends each arrow in its own head", () => {
    const doc = parse(drawSequence(seqLayout(), pal, "s"));
    // Upright and in the line colour: a note's rule is upright too, in the
    // muted.
    const lifelines = [...doc.querySelectorAll("line")].filter(
      (x) =>
        x.getAttribute("x1") === x.getAttribute("x2") &&
        x.getAttribute("stroke") === pal.line,
    );
    expect(lifelines).toHaveLength(3);
    for (const x of lifelines)
      expect(x.getAttribute("stroke-dasharray")).toBe("4 4");
    const arrows = [...doc.querySelectorAll(lines)];
    expect(arrows.map((p) => p.getAttribute("marker-end"))).toEqual([
      "url(#s-arrow)",
      "url(#s-arrow)",
      "url(#s-open)",
      "url(#s-cross)",
      null,
      "url(#s-arrow)",
    ]);
    expect(arrows.map((p) => p.getAttribute("stroke-dasharray"))).toEqual([
      null,
      "5 4",
      null,
      null,
      null,
      null,
    ]);
    for (const p of arrows) expect(p.getAttribute("stroke")).toBe(pal.muted);
    expect(doc.querySelectorAll("marker")).toHaveLength(3);
  });

  it("uses no accent and no amber", () => {
    const svg = drawSequence(seqLayout(), pal, "s");
    expect(svg).not.toContain(pal.accent);
    expect(svg).not.toContain(pal.warn);
  });

  it("puts every text on a patch of its ground, the frame's tint inside a frame", () => {
    const doc = parse(drawSequence(seqLayout(), pal, "s"));
    const patchOf = (word: string) => {
      const t = [...doc.querySelectorAll("text")].find(
        (x) => x.textContent === word,
      )!;
      const prev = t.previousElementSibling!;
      expect(prev.tagName).toBe("rect");
      return prev.getAttribute("fill");
    };
    expect(patchOf("CALL")).toBe(pal.tint);
    expect(patchOf("ASYNC")).toBe(pal.surface);
    expect(patchOf("delivered")).toBe(pal.tint);
  });

  it("sets a message's text as a note on its arrow: muted mono capitals, tracked", () => {
    const doc = parse(drawSequence(seqLayout(), pal, "s"));
    const t = [...doc.querySelectorAll("text")].find(
      (x) => x.textContent === "CALL",
    )!;
    expect(t.getAttribute("fill")).toBe(pal.muted);
    expect(t.getAttribute("font-family")).toBe(pal.mono);
    expect(t.getAttribute("font-size")).toBe("10");
    expect(t.getAttribute("letter-spacing")).toBe("0.08em");
  });

  it("draws a note as an aside: a tinted patch with a rule on its left, no frame", () => {
    const doc = parse(drawSequence(seqLayout(), pal, "s"));
    const t = [...doc.querySelectorAll("text")].find(
      (x) => x.textContent === "a note",
    )!;
    expect(t.getAttribute("fill")).toBe(pal.muted);
    const rule = t.previousElementSibling!;
    expect(rule.tagName).toBe("line");
    expect(rule.getAttribute("x1")).toBe(rule.getAttribute("x2"));
    const patch = rule.previousElementSibling!;
    expect(patch.getAttribute("fill")).toBe(pal.tint);
    expect(patch.getAttribute("stroke")).toBeNull();
  });

  it("frames a participant as a step is framed", () => {
    const doc = parse(drawSequence(seqLayout(), pal, "s"));
    const t = [...doc.querySelectorAll("text")].find(
      (x) => x.textContent === "Checkout",
    )!;
    expect(t.previousElementSibling!.getAttribute("stroke")).toBe("#76746f");
  });

  it("titles a frame with its keyword in a tab, then its condition in the muted", () => {
    const doc = parse(drawSequence(seqLayout(), pal, "s"));
    const texts = [...doc.querySelectorAll("text")];
    const kw = texts.find((t) => t.textContent === "ALT")!;
    expect(kw.getAttribute("fill")).toBe(pal.muted);
    expect(kw.getAttribute("letter-spacing")).toBe("0.12em");
    const tab = kw.previousElementSibling!;
    expect(tab.tagName).toBe("rect");
    expect(tab.getAttribute("stroke")).toBe(pal.line);
    expect(Number(tab.getAttribute("x"))).toBeLessThan(
      Number(kw.getAttribute("x")),
    );
    const cond = texts.find((t) => t.textContent === "nothing delivered")!;
    expect(Number(cond.getAttribute("x"))).toBeGreaterThan(
      Number(tab.getAttribute("x")) + Number(tab.getAttribute("width")),
    );
    expect(cond.getAttribute("fill")).toBe(pal.muted);
    expect(Number(cond.getAttribute("x"))).toBeGreaterThan(
      Number(kw.getAttribute("x")),
    );
    expect(cond.getAttribute("y")).toBe(kw.getAttribute("y"));
  });

  it("keeps the keyword's tab inside the title band the check sees", () => {
    const l = seqLayout();
    const doc = parse(drawSequence(l, pal, "s"));
    const kw = [...doc.querySelectorAll("text")].find(
      (t) => t.textContent === "ALT",
    )!;
    const tab = kw.previousElementSibling!;
    const t = l.frames[0].title;
    expect(Number(tab.getAttribute("y"))).toBeGreaterThanOrEqual(t.y);
    expect(
      Number(tab.getAttribute("y")) + Number(tab.getAttribute("height")),
    ).toBeLessThanOrEqual(t.y + t.h);
  });

  it("ends a head on its lifeline, a cross centred on it", () => {
    const l = seqLayout();
    const doc = parse(drawSequence(l, pal, "s"));
    const end = (i: number) =>
      Number(
        doc
          .querySelectorAll(lines)
          [i].getAttribute("d")!
          .split(" ")
          .slice(-1)[0]
          .replace(/^[A-Z]/, "")
          .split(",")[0],
      );
    const b = l.lifelines.find((x) => x.id === "b")!.x;
    expect(end(2)).toBe(b - 1);
    expect(end(3)).toBe(b);
  });
});

function msg(
  from: string,
  to: string,
  label: string,
  over: Partial<Extract<SeqRow, { type: "message" }>> = {},
): SeqRow {
  return {
    type: "message",
    from,
    to,
    label,
    line: "solid",
    head: "filled",
    ...over,
  };
}
