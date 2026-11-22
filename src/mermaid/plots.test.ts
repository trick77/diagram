import { beforeAll, describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { axisName, toIR } from "./ir";
import { escapeAngles } from "./text";
import { editorial } from "./editorial";
import type { QuadrantIR, TimelineIR } from "../ir";

// The renderer's parse for a timeline and a quadrant chart, read through
// its real db: a renderer bump that moves either breaks here.
beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
});

async function ir(src: string) {
  const d = await mermaid.mermaidAPI.getDiagramFromText(src);
  return toIR(d.type, d.db);
}

describe("toIR for a timeline", () => {
  it("reads periods with their events, sections and the title", async () => {
    const t = (await ir(`timeline
  title Road to launch
  Draft : Outline
  section Prepare
    Kickoff : Scope fixed : Team ready
    Pilot : First users
  section Ship
    Rollout
    Review : Lessons <b>learned</b> &amp; more`)) as TimelineIR;
    expect(t).toEqual({
      kind: "timeline",
      title: "Road to launch",
      periods: [
        { label: "Draft", events: ["Outline"] },
        {
          label: "Kickoff",
          events: ["Scope fixed", "Team ready"],
          section: "Prepare",
        },
        { label: "Pilot", events: ["First users"], section: "Prepare" },
        { label: "Rollout", events: [], section: "Ship" },
        {
          label: "Review",
          events: ["Lessons learned & more"],
          section: "Ship",
        },
      ],
    });
  });

  it("keeps an angle bracket, escaped on the way to the parse", async () => {
    const src = `timeline
  title Up <to> launch
  Now : Pilot with <10 users`;
    const t = (await ir(escapeAngles(src))) as TimelineIR;
    expect(t.title).toBe("Up <to> launch");
    expect(t.periods[0].events).toEqual(["Pilot with <10 users"]);
  });

  it("reads one without a title as an empty one", async () => {
    const t = (await ir(`timeline
  2025 : Kickoff
  2026 : Rollout`)) as TimelineIR;
    expect(t.title).toBe("");
    expect(t.periods.map((p) => p.label)).toEqual(["2025", "2026"]);
  });

  it("declines a db missing what it reads", () => {
    expect(toIR("timeline", { getTasks: () => [] })).toBeNull();
    expect(
      toIR("timeline", {
        getTasks: () => [],
        getCommonDb: () => ({ getDiagramTitle: () => "" }),
      }),
    ).toBeNull();
  });
});

describe("toIR for a quadrant chart", () => {
  const src = `quadrantChart
  title Where to start
  x-axis Low effort --> High effort
  y-axis Impact
  quadrant-1 Big bets
  quadrant-2 Do first
  quadrant-3 Fill-ins
  quadrant-4 Skip
  Automate reports:::focus: [0.3, 0.8]
  Rewrite onboarding: [0.75, 0.6] radius: 9
  Corner: [0, 1]`;

  it("reads points in the order written, at their 0..1 place", async () => {
    const q = (await ir(src)) as QuadrantIR;
    expect(q).toEqual({
      kind: "quadrant",
      title: "Where to start",
      xAxis: "Effort",
      yAxis: "Impact",
      quadrants: ["Big bets", "Do first", "Fill-ins", "Skip"],
      points: [
        { label: "Automate reports", x: 0.3, y: 0.8, focus: true },
        { label: "Rewrite onboarding", x: 0.75, y: 0.6 },
        { label: "Corner", x: 0, y: 1 },
      ],
    });
  });

  it("reads a focus the source styles itself", async () => {
    const q = (await ir(`quadrantChart
  A:::focus: [0.2, 0.2]
  B: [0.6, 0.6]
  classDef focus color: #ff0000`)) as QuadrantIR;
    expect(q.points.map((p) => p.focus ?? false)).toEqual([true, false]);
  });

  it("loses a focus whose point paints itself", async () => {
    // The point's own colour outranks its class's: the one read this way
    // cannot see.
    const q = (await ir(`quadrantChart
  A:::focus: [0.2, 0.2] color: #00ff00`)) as QuadrantIR;
    expect(q.points[0].focus).toBeUndefined();
  });

  it("reads a chart with nothing but points", async () => {
    const q = (await ir(`quadrantChart
  A: [0.2, 0.4]`)) as QuadrantIR;
    expect(q).toMatchObject({
      title: "",
      xAxis: "",
      yAxis: "",
      quadrants: ["", "", "", ""],
      points: [{ label: "A", x: 0.2, y: 0.4 }],
    });
  });

  it("hands an axis it cannot name in a word to the renderer", async () => {
    expect(
      await ir(`quadrantChart
  x-axis Almost no effort at all --> A very large amount of effort
  A: [0.2, 0.4]`),
    ).toBeNull();
  });

  it("declines a db missing what it reads", () => {
    expect(toIR("quadrantChart", { getQuadrantData: () => ({}) })).toBeNull();
  });
});

describe("axisName", () => {
  it("takes the one text an axis has", () => {
    expect(axisName(["Effort"])).toBe("Effort");
    expect(axisName([])).toBe("");
    expect(axisName(["", ""])).toBe("");
  });

  it("takes what both ends share past their first word", () => {
    expect(axisName(["Low effort", "High effort"])).toBe("Effort");
    expect(axisName(["Niedriger Aufwand", "Hoher Aufwand"])).toBe("Aufwand");
    expect(axisName(["low business value", "high business value"])).toBe(
      "Business value",
    );
  });

  it("takes the high end when it is one concept", () => {
    expect(axisName(["Low", "High"])).toBe("High");
    expect(axisName(["Cheap", "Costly"])).toBe("Costly");
    expect(axisName(["Few users", "Many active users"])).toBeNull();
  });
});

describe("a quadrant chart too crowded to label", () => {
  it("is refused by the own drawing, for the renderer to draw", async () => {
    const points = Array.from(
      { length: 7 },
      (_, i) => `  Idea number ${i + 1}: [0.2${i % 2}, 0.${800 - i * 4}]`,
    );
    await expect(
      editorial(mermaid, ["quadrantChart", ...points].join("\n"), "x"),
    ).rejects.toThrow(/no room for the label/);
  });
});

describe("two drawn at once", () => {
  // The renderer keeps one timeline db and one quadrant builder for the
  // page: a second parse landing between another's parse and its read
  // would draw the one source's picture for the other.
  it("draw each its own source", async () => {
    const pair = async (a: string, b: string) =>
      Promise.all([
        editorial(mermaid, a, "a"),
        editorial(mermaid, b, "b"),
        editorial(mermaid, a, "c"),
      ]);
    const [t1, t2, t3] = await pair(
      "timeline\n  Alpha : First",
      "timeline\n  Beta : Second",
    );
    expect(t1).toContain("Alpha");
    expect(t1).not.toContain("Beta");
    expect(t2).toContain("Beta");
    expect(t2).not.toContain("Alpha");
    expect(t3).toContain("Alpha");
    const [q1, q2] = await pair(
      "quadrantChart\n  Gamma:::focus: [0.2, 0.3]",
      "quadrantChart\n  Delta: [0.7, 0.8]",
    );
    expect(q1).toContain("Gamma");
    expect(q1).not.toContain("Delta");
    expect(q2).toContain("Delta");
    expect(q2).not.toContain("Gamma");
  });
});
