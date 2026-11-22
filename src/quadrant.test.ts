import { describe, it, expect } from "vitest";
import type { QuadrantIR, QuadrantPointIR } from "./ir";
import {
  Crowded,
  labelGap,
  layoutQuadrant,
  nudgeMax,
  plotSize,
  type QuadrantLayout,
} from "./quadrant";
import { checkQuadrant } from "./check/plot";
import { fits } from "./fits";
import { drawQuadrant } from "./draw";
import type { Palette } from "./theme";

const pt = (label: string, x: number, y: number, focus = false) => {
  const p: QuadrantPointIR = { label, x, y };
  if (focus) p.focus = true;
  return p;
};
const quadrant = (
  points: QuadrantPointIR[],
  over: Partial<QuadrantIR> = {},
): QuadrantIR => ({
  kind: "quadrant",
  title: "",
  xAxis: "Effort",
  yAxis: "Impact",
  quadrants: ["Big bets", "Do first", "Fill-ins", "Skip"],
  points,
  ...over,
});
const labelOf = (l: QuadrantLayout, s: string) =>
  l.texts.find((t) => t.kind === "point" && t.lines.join(" ") === s)!;
const dotOf = (l: QuadrantLayout, i: number) => l.dots[i];

describe("layoutQuadrant", () => {
  it("leaves the drawing's 32 round everything it draws", () => {
    const l = layoutQuadrant(quadrant([pt("Automate reports", 0.3, 0.8)]));
    for (const t of l.texts) {
      expect(t.x).toBeGreaterThanOrEqual(32);
      expect(t.y).toBeGreaterThanOrEqual(32);
    }
    expect(l.plot.x).toBeGreaterThanOrEqual(32);
  });

  it("draws a square plot with the axis cross through its centre", () => {
    const l = layoutQuadrant(quadrant([pt("Automate reports", 0.3, 0.8)]));
    const p = l.plot;
    expect(p.size).toBe(plotSize);
    const [x, y] = l.axes;
    expect(x.y1).toBe(p.y + p.size / 2);
    expect(x.x1).toBe(p.x);
    expect(x.x2).toBeGreaterThan(p.x + p.size);
    expect(y.x1).toBe(p.x + p.size / 2);
    expect(y.y1).toBe(p.y + p.size);
    expect(y.y2).toBeLessThan(p.y);
    expect(checkQuadrant(l)).toEqual([]);
  });

  it("puts each axis's name beyond its tip", () => {
    const l = layoutQuadrant(quadrant([]));
    const axis = (s: string) => l.texts.find((t) => t.lines[0] === s)!;
    const xName = axis("Effort");
    const yName = axis("Impact");
    expect(xName.kind).toBe("axis");
    const [x, y] = l.axes;
    expect(xName.lines).toEqual(["Effort"]);
    expect(xName.x).toBeGreaterThan(x.x2);
    expect(xName.y + xName.h / 2).toBeCloseTo(x.y1, 0);
    expect(yName.lines).toEqual(["Impact"]);
    expect(yName.y + yName.h).toBeLessThan(y.y2);
    expect(yName.x + yName.w / 2).toBeCloseTo(y.x1, 0);
  });

  it("names the quadrants in their outer corners, as mermaid numbers them", () => {
    const l = layoutQuadrant(quadrant([]));
    const p = l.plot;
    const c = { x: p.x + p.size / 2, y: p.y + p.size / 2 };
    const at = (s: string) => l.texts.find((t) => t.lines[0] === s)!;
    const one = at("Big bets");
    const two = at("Do first");
    const three = at("Fill-ins");
    const four = at("Skip");
    expect(one.x).toBeGreaterThan(c.x);
    expect(one.y).toBeLessThan(c.y);
    expect(two.x + two.w).toBeLessThan(c.x);
    expect(two.y).toBeLessThan(c.y);
    expect(three.x + three.w).toBeLessThan(c.x);
    expect(three.y).toBeGreaterThan(c.y);
    expect(four.x).toBeGreaterThan(c.x);
    expect(four.y).toBeGreaterThan(c.y);
    for (const t of [one, two, three, four]) expect(t.role).toBe("muted");
  });

  it("sets a label to the right of its dot", () => {
    const l = layoutQuadrant(quadrant([pt("Automate reports", 0.6, 0.3)]));
    const t = labelOf(l, "Automate reports");
    const d = dotOf(l, 0);
    expect(t.x).toBe(d.x + labelGap);
    expect(t.y + t.h / 2).toBeCloseTo(d.y, 0);
    expect(t.role).toBe("fg");
  });

  it("sets it to the left near the right edge", () => {
    const l = layoutQuadrant(
      quadrant([
        pt("Rewrite onboarding", 0.95, 0.7),
        pt("Cut meetings", 0.9, 0.2),
      ]),
    );
    for (const [s, i] of [
      ["Rewrite onboarding", 0],
      ["Cut meetings", 1],
    ] as const) {
      const t = labelOf(l, s);
      expect(t.x + t.w).toBe(dotOf(l, i).x - labelGap);
      expect(t.anchor).toBe("end");
    }
    expect(checkQuadrant(l)).toEqual([]);
  });

  it("never lets a label just left of centre cross the vertical axis", () => {
    const l = layoutQuadrant(
      quadrant([pt("Consolidate the vendor list", 0.45, 0.6)]),
    );
    const t = labelOf(l, "Consolidate the vendor list");
    expect(t.x + t.w).toBeLessThan(l.axes[1].x1);
    expect(checkQuadrant(l)).toEqual([]);
  });

  it("wraps a label that fits neither side whole", () => {
    const l = layoutQuadrant(
      quadrant([pt("Move every weekly report to one shared page", 0.25, 0.6)]),
    );
    const t = labelOf(l, "Move every weekly report to one shared page");
    expect(t.lines.length).toBeGreaterThan(1);
    expect(checkQuadrant(l)).toEqual([]);
  });

  it("keeps a label off the horizontal axis", () => {
    const l = layoutQuadrant(quadrant([pt("Tidy backlog", 0.2, 0.51)]));
    const t = labelOf(l, "Tidy backlog");
    expect(t.y + t.h).toBeLessThan(l.axes[0].y1);
    expect(checkQuadrant(l)).toEqual([]);
  });

  it("nudges crowded labels apart, each still beside its dot", () => {
    const crowded = quadrant([
      pt("Automate reports", 0.15, 0.82),
      pt("Tidy backlog", 0.16, 0.8),
      pt("Share a glossary", 0.15, 0.78),
      pt("Plan the offsite", 0.17, 0.76),
    ]);
    const l = layoutQuadrant(crowded);
    expect(checkQuadrant(l)).toEqual([]);
    const ys = crowded.points.map((p) => labelOf(l, p.label).y);
    expect(new Set(ys).size).toBe(4);
    crowded.points.forEach((p, i) => {
      const t = labelOf(l, p.label);
      expect(Math.abs(t.y + t.h / 2 - dotOf(l, i).y)).toBeLessThanOrEqual(
        nudgeMax,
      );
    });
  });

  it("joins a label moved well off its dot's height back to it", () => {
    const l = layoutQuadrant(
      quadrant([
        pt("Automate reports", 0.15, 0.82),
        pt("Tidy backlog", 0.16, 0.8),
        pt("Share a glossary", 0.15, 0.78),
      ]),
    );
    expect(checkQuadrant(l)).toEqual([]);
    // The third is pushed down past half a line: one hairline, from the
    // edge of its dot to the near side of its label.
    expect(l.leaders).toHaveLength(1);
    const [s] = l.leaders;
    const d = l.dots[2];
    const t = labelOf(l, "Share a glossary");
    expect(Math.hypot(s.x1 - d.x, s.y1 - d.y)).toBeCloseTo(d.r + 2, 5);
    expect(s.x2).toBe(t.x - 2);
    expect(s.y2).toBe(t.y + t.lineH / 2);
    // Level with its dot, or nearly: none.
    expect(layoutQuadrant(quadrant([pt("Pilot", 0.6, 0.3)])).leaders).toEqual(
      [],
    );
  });

  it("draws a cluster whose leaders would cross a label without them", () => {
    const l = layoutQuadrant(
      quadrant([
        pt("Automate reports", 0.15, 0.82),
        pt("Tidy backlog", 0.16, 0.8),
        pt("Share a glossary", 0.15, 0.78),
        pt("Plan the offsite", 0.17, 0.76),
      ]),
    );
    expect(checkQuadrant(l)).toEqual([]);
  });

  it("declines a cluster it cannot label without covering a label", () => {
    const pile = quadrant(
      Array.from({ length: 7 }, (_, i) =>
        pt(`Idea number ${i + 1}`, 0.2 + (i % 2) * 0.01, 0.8 - i * 0.004),
      ),
    );
    expect(() => layoutQuadrant(pile)).toThrow(Crowded);
  });

  it("declines a word wider than its quadrant", () => {
    expect(() =>
      layoutQuadrant(
        quadrant([
          pt(
            "Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichen",
            0.3,
            0.7,
          ),
        ]),
      ),
    ).toThrow(Crowded);
  });

  it("moves a label off a quadrant's name", () => {
    const l = layoutQuadrant(quadrant([pt("Archive old pages", 0.04, 0.97)]));
    expect(checkQuadrant(l)).toEqual([]);
  });

  it("marks the focus in the accent: a larger dot and a bold label", () => {
    const l = layoutQuadrant(
      quadrant([pt("Automate reports", 0.3, 0.8, true), pt("Pilot", 0.7, 0.3)]),
    );
    expect(l.dots.map((d) => d.focus)).toEqual([true, false]);
    expect(l.dots[0].r).toBeGreaterThan(l.dots[1].r);
    expect(labelOf(l, "Automate reports")).toMatchObject({
      role: "accent",
      bold: true,
    });
    expect(labelOf(l, "Pilot").role).toBe("fg");
  });

  it("puts a title above everything as an eyebrow", () => {
    const l = layoutQuadrant(quadrant([], { title: "Where to start" }));
    const [t] = l.texts.filter((o) => o.kind === "title");
    for (const o of l.texts.filter((o) => o !== t))
      expect(o.y).toBeGreaterThanOrEqual(t.y + t.h);
    expect(checkQuadrant(l)).toEqual([]);
  });

  it("draws axes without names when the source gives none", () => {
    const l = layoutQuadrant(
      quadrant([pt("A", 0.5, 0.5)], {
        xAxis: "",
        yAxis: "",
        quadrants: ["", "", "", ""],
      }),
    );
    expect(l.texts.filter((t) => t.kind !== "point")).toEqual([]);
    expect(checkQuadrant(l)).toEqual([]);
  });

  it("keeps a point written past the plot on its edge", () => {
    const l = layoutQuadrant(quadrant([pt("Over", 1.4, -0.2)]));
    expect(l.dots[0]).toMatchObject({
      x: l.plot.x + l.plot.size,
      y: l.plot.y + l.plot.size,
    });
  });
});

describe("fits a quadrant", () => {
  it("up to twelve points", () => {
    const of = (n: number) =>
      quadrant(Array.from({ length: n }, (_, i) => pt(`P${i}`, 0.5, 0.5)));
    expect(fits(of(12))).toBe(true);
    expect(fits(of(13))).toBe(false);
    expect(fits(of(13), { points: 13 })).toBe(true);
  });
});

describe("drawQuadrant", () => {
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
  const parse = (svg: string) =>
    new DOMParser().parseFromString(svg, "image/svg+xml");
  const doc = parse(
    drawQuadrant(
      layoutQuadrant(
        quadrant([pt("Ship <v2>", 0.3, 0.8, true), pt("Pilot", 0.7, 0.3)], {
          title: "Where to start",
        }),
      ),
      pal,
      "q",
    ),
  );
  const text = (s: string) =>
    [...doc.querySelectorAll("text")].find((t) => t.textContent === s)!;

  it("frames the plot in a hairline and fills no quadrant", () => {
    const rects = [...doc.querySelectorAll("rect")];
    // The canvas and the plot's frame, nothing else.
    expect(rects).toHaveLength(2);
    expect(rects[1].getAttribute("fill")).toBe("none");
    expect(rects[1].getAttribute("stroke")).toBe(pal.line);
  });

  it("draws the axis cross muted, a head at each high end", () => {
    const axes = [...doc.querySelectorAll("line")];
    expect(axes).toHaveLength(2);
    for (const a of axes) {
      expect(a.getAttribute("stroke")).toBe(pal.muted);
      expect(a.getAttribute("marker-end")).toBe("url(#q-axis)");
    }
    expect(doc.querySelector("marker#q-axis path")?.getAttribute("fill")).toBe(
      pal.muted,
    );
  });

  it("marks only the focus in the accent", () => {
    const fills = [...doc.querySelectorAll("circle")].map((c) =>
      c.getAttribute("fill"),
    );
    expect(fills).toEqual([pal.accent, pal.fg]);
    // Escaped on the way out, a bracket is text.
    expect(text("Ship <v2>").getAttribute("fill")).toBe(pal.accent);
    expect(text("Ship <v2>").getAttribute("font-weight")).toBe("600");
    expect(text("Pilot").getAttribute("fill")).toBe(pal.fg);
    expect(text("Do first").getAttribute("fill")).toBe(pal.muted);
    expect(text("Effort").getAttribute("letter-spacing")).toBe("0.06em");
  });
});
