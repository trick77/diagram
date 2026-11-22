import { describe, it, expect } from "vitest";
import type { PeriodIR, TimelineIR } from "./ir";
import { layoutTimeline, minStep, type TimelineLayout } from "./timeline";
import { checkTimeline } from "./check/plot";
import { fits } from "./fits";
import { drawTimeline } from "./draw";
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

const period = (label: string, ...events: string[]): PeriodIR => ({
  label,
  events,
});
const timeline = (periods: PeriodIR[], title = ""): TimelineIR => ({
  kind: "timeline",
  title,
  periods,
});
const five = timeline([
  period("Week 1", "Kickoff"),
  period("Week 2", "Scope fixed"),
  period("Week 3", "Pilot"),
  period("Week 4", "Rollout"),
  period("Week 5", "Review"),
]);
const nine = timeline(
  Array.from({ length: 9 }, (_, i) => period(`Phase ${i + 1}`, "Step done")),
);
const texts = (l: TimelineLayout, kind: string) =>
  l.texts.filter((t) => t.kind === kind);
const mid = (t: { x: number; w: number }) => t.x + t.w / 2;

describe("layoutTimeline", () => {
  it("leaves the drawing's 32 round its text, lying flat or standing", () => {
    for (const l of [layoutTimeline(five, 1200), layoutTimeline(five, 300)])
      for (const t of l.texts) {
        expect(t.x).toBeGreaterThanOrEqual(32);
        expect(t.y).toBeGreaterThanOrEqual(32);
      }
  });

  it("lies flat where the width holds a column per period", () => {
    const l = layoutTimeline(five, 1200);
    expect(l.orient).toBe("horizontal");
    expect(l.width).toBe(l.wide);
    // Equally spaced: the source names periods, it does not date them.
    const xs = l.dots.map((d) => d.x);
    const steps = xs.slice(1).map((x, i) => x - xs[i]);
    expect(new Set(steps).size).toBe(1);
    expect(steps[0]).toBe(minStep);
    expect(new Set(l.dots.map((d) => d.y)).size).toBe(1);
    expect(l.line.y1).toBe(l.dots[0].y);
    expect(l.line.y2).toBe(l.dots[0].y);
    expect(checkTimeline(l)).toEqual([]);
  });

  it("sets labels above and below the line by turns, centred on the dot", () => {
    const l = layoutTimeline(five, 1200);
    const base = l.dots[0].y;
    texts(l, "event").forEach((t, i) => {
      expect(mid(t)).toBeCloseTo(l.dots[i].x, 0);
      if (i % 2 === 0) expect(t.y + t.h).toBeLessThan(base);
      else expect(t.y).toBeGreaterThan(base);
    });
    // A hairline drop from each dot towards its labels, clear of both.
    expect(l.drops).toHaveLength(5);
    expect(l.drops[0].y2).toBeLessThan(l.drops[0].y1);
    expect(l.drops[1].y2).toBeGreaterThan(l.drops[1].y1);
  });

  it("names the period over what happened in it, muted and bold", () => {
    const l = layoutTimeline(five, 1200);
    const [p] = texts(l, "period");
    const [e] = texts(l, "event");
    expect(p).toMatchObject({ role: "muted", bold: true, lines: ["Week 1"] });
    expect(e).toMatchObject({ role: "fg", bold: false, lines: ["Kickoff"] });
    expect(p.y + p.h).toBeLessThanOrEqual(e.y);
  });

  it("stands up where the width is short of the flat one", () => {
    const l = layoutTimeline(nine, 700);
    expect(l.wide).toBeGreaterThan(700);
    expect(l.orient).toBe("vertical");
    expect(new Set(l.dots.map((d) => d.x)).size).toBe(1);
    expect(l.line.x1).toBe(l.dots[0].x);
    const ys = l.dots.map((d) => d.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    // The period to the left of the line, set flush against it; what
    // happened to the right.
    for (const p of texts(l, "period")) {
      expect(p.anchor).toBe("end");
      expect(p.x + p.w).toBeLessThan(l.line.x1);
    }
    for (const e of texts(l, "event")) expect(e.x).toBeGreaterThan(l.line.x1);
    expect(checkTimeline(l)).toEqual([]);
  });

  it("decides the orientation on the width alone, at the flat one's width", () => {
    const wide = layoutTimeline(five, 10000).wide;
    expect(layoutTimeline(five, wide).orient).toBe("horizontal");
    expect(layoutTimeline(five, wide - 1).orient).toBe("vertical");
    expect(layoutTimeline(five, wide - 1).wide).toBe(wide);
    // No width known: standing up fits any column.
    expect(layoutTimeline(five).orient).toBe("vertical");
    // Five short periods lie flat in a 720px text column, nine do not.
    expect(layoutTimeline(five, 720).orient).toBe("horizontal");
    expect(layoutTimeline(nine, 720).orient).toBe("vertical");
  });

  it("steps by its labels: a label may pass the next dot, not the one after", () => {
    const word = "Informationssicherheitsrichtlinien";
    const wide = layoutTimeline(
      timeline([
        period("Q1", word),
        period("Q2", "Pilot"),
        period("Q3", word),
        period("Q4", "Review"),
      ]),
      2000,
    );
    expect(wide.dots[1].x - wide.dots[0].x).toBeGreaterThan(minStep);
    const [q1, , q3] = texts(wide, "event");
    // On one side of the line, the two run apart by the clear space.
    expect(q3.x - (q1.x + q1.w)).toBeGreaterThanOrEqual(19);
    expect(checkTimeline(wide)).toEqual([]);

    // A long label beside a short one passes the next dot, whose labels
    // are on the other side, and leaves the step as it was.
    const past = layoutTimeline(
      timeline([period("Q1", word), period("Q2", "Pilot"), period("Q3", "Go")]),
      2000,
    );
    expect(past.dots[1].x - past.dots[0].x).toBe(minStep);
    const [p1] = texts(past, "event");
    expect(p1.x + p1.w).toBeGreaterThan(past.dots[1].x);
    expect(checkTimeline(past)).toEqual([]);
  });

  it("keeps a word that cannot wrap whole", () => {
    const l = layoutTimeline(
      timeline([
        period("Q1", "Internationalisierungsprojektleitung"),
        period("Q2", "Pilot"),
        period("Q3", "Rollout"),
      ]),
      2000,
    );
    expect(texts(l, "event")[0].lines).toHaveLength(1);
    expect(checkTimeline(l)).toEqual([]);
  });

  it("puts a title above everything as an eyebrow", () => {
    for (const w of [1200, 300]) {
      const l = layoutTimeline({ ...five, title: "Road to launch" }, w);
      const [t] = texts(l, "title");
      expect(t).toMatchObject({ role: "muted", bold: true });
      expect(t.track).toBeGreaterThan(0);
      for (const o of l.texts.filter((o) => o !== t))
        expect(o.y).toBeGreaterThanOrEqual(t.y + t.h);
      expect(checkTimeline(l)).toEqual([]);
    }
  });

  it("stacks several events of one period in the order written", () => {
    const multi = timeline([
      period("Spring", "Survey sent", "Answers in", "Report out"),
      period("Summer", "Pilot"),
      period("Autumn", "Rollout", "Training"),
    ]);
    for (const w of [1200, 300]) {
      const l = layoutTimeline(multi, w);
      const first = texts(l, "event").slice(0, 3);
      expect(first.map((t) => t.lines.join(" "))).toEqual([
        "Survey sent",
        "Answers in",
        "Report out",
      ]);
      expect(first[1].y).toBeGreaterThan(first[0].y);
      expect(first[2].y).toBeGreaterThan(first[1].y);
      expect(checkTimeline(l)).toEqual([]);
    }
  });

  it("names a section over its periods, flat or standing", () => {
    const sec = timeline([
      { ...period("Jan", "Kickoff"), section: "Prepare" },
      { ...period("Feb", "Pilot"), section: "Prepare" },
      { ...period("Mar", "Rollout"), section: "Ship" },
      { ...period("Apr", "Review"), section: "Ship" },
    ]);
    const flat = layoutTimeline(sec, 1200);
    expect(flat.orient).toBe("horizontal");
    const names = texts(flat, "section");
    expect(names.map((t) => t.lines[0])).toEqual(["Prepare", "Ship"]);
    // Over every label above the line, and its rule spans its own columns.
    const above = flat.texts.filter(
      (t) => t.kind !== "title" && t.kind !== "section",
    );
    for (const n of names)
      for (const t of above) expect(n.y + n.h).toBeLessThan(t.y);
    expect(flat.rules).toHaveLength(2);
    expect(flat.rules[0].x1).toBeLessThan(flat.dots[0].x);
    expect(flat.rules[0].x2).toBeGreaterThan(flat.dots[1].x);
    expect(flat.rules[0].x2).toBeLessThan(flat.rules[1].x1);
    expect(checkTimeline(flat)).toEqual([]);

    const up = layoutTimeline(sec, 300);
    const [, ship] = texts(up, "section");
    const mar = texts(up, "event")[2];
    expect(ship.y + ship.h).toBeLessThan(mar.y);
    expect(ship.y).toBeGreaterThan(texts(up, "event")[1].y);
    expect(checkTimeline(up)).toEqual([]);
  });

  it("draws a period with nothing in it as its name alone", () => {
    const l = layoutTimeline(
      timeline([period("Now"), period("Later", "Done")]),
      900,
    );
    expect(texts(l, "period")).toHaveLength(2);
    expect(texts(l, "event")).toHaveLength(1);
    expect(checkTimeline(l)).toEqual([]);
  });
});

describe("fits a timeline", () => {
  it("up to twelve periods of up to four events", () => {
    const of = (n: number, events: number) =>
      timeline(
        Array.from({ length: n }, (_, i) =>
          period(`P${i}`, ...Array.from({ length: events }, () => "Done")),
        ),
      );
    expect(fits(of(12, 4))).toBe(true);
    expect(fits(of(13, 1))).toBe(false);
    expect(fits(of(2, 5))).toBe(false);
    expect(fits(of(13, 1), { periods: 13 })).toBe(true);
  });
});

describe("drawTimeline", () => {
  const parse = (svg: string) =>
    new DOMParser().parseFromString(svg, "image/svg+xml");

  it("says which way it lies and the width it lies flat at", () => {
    const flat = parse(drawTimeline(layoutTimeline(five, 1200), pal));
    const root = flat.documentElement;
    expect(root.getAttribute("data-orient")).toBe("horizontal");
    const wide = Number(root.getAttribute("data-wide"));
    expect(wide).toBe(Number(root.getAttribute("width")));
    const up = parse(drawTimeline(layoutTimeline(five, wide - 1), pal));
    expect(up.documentElement.getAttribute("data-orient")).toBe("vertical");
    expect(up.documentElement.getAttribute("data-wide")).toBe(String(wide));
  });

  it("draws the line, a dot per period and every text, muted where it frames", () => {
    const doc = parse(
      drawTimeline(
        layoutTimeline({ ...five, title: "Road & launch" }, 1200),
        pal,
      ),
    );
    // The canvas, the baseline and five drops.
    expect(doc.querySelectorAll("line")).toHaveLength(6);
    expect(
      [...doc.querySelectorAll("circle")].map((c) => c.getAttribute("fill")),
    ).toEqual(Array(5).fill(pal.fg));
    const text = (s: string) =>
      [...doc.querySelectorAll("text")].find((t) => t.textContent === s)!;
    expect(text("Week 1").getAttribute("fill")).toBe(pal.muted);
    expect(text("Week 1").getAttribute("font-weight")).toBe("600");
    expect(text("Kickoff").getAttribute("fill")).toBe(pal.fg);
    expect(text("Kickoff").getAttribute("text-anchor")).toBe("middle");
    // The title escaped, tracked as an eyebrow.
    expect(text("Road & launch").getAttribute("letter-spacing")).toBe("0.08em");
    expect(doc.querySelector("[fill='" + pal.accent + "']")).toBeNull();
  });

  it("sets a standing timeline's periods flush against the line", () => {
    const doc = parse(drawTimeline(layoutTimeline(nine, 700), pal));
    const p = [...doc.querySelectorAll("text")].find(
      (t) => t.textContent === "Phase 1",
    )!;
    expect(p.getAttribute("text-anchor")).toBe("end");
  });
});
