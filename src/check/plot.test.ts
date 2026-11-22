import { describe, it, expect } from "vitest";
import { checkQuadrant, checkTimeline } from "./plot";
import type { PlotText } from "../plot";
import type { TimelineLayout } from "../timeline";
import type { QuadrantLayout } from "../quadrant";

const text = (over: Partial<PlotText>): PlotText => ({
  kind: "event",
  lines: ["Pilot"],
  x: 40,
  y: 20,
  w: 40,
  h: 18,
  size: 13,
  lineH: 18,
  bold: false,
  role: "fg",
  anchor: "start",
  track: 0,
  ...over,
});

const timeline = (over: Partial<TimelineLayout>): TimelineLayout => ({
  width: 300,
  height: 120,
  orient: "horizontal",
  wide: 300,
  line: { x1: 20, y1: 60, x2: 280, y2: 60 },
  dots: [{ x: 60, y: 60, r: 4 }],
  drops: [],
  rules: [],
  texts: [text({})],
  ...over,
});

const quadrant = (over: Partial<QuadrantLayout>): QuadrantLayout => ({
  width: 300,
  height: 300,
  plot: { x: 20, y: 20, size: 200 },
  axes: [
    { x1: 20, y1: 120, x2: 236, y2: 120 },
    { x1: 120, y1: 220, x2: 120, y2: 4 },
  ],
  dots: [{ x: 50, y: 50, r: 4, focus: false }],
  leaders: [],
  texts: [text({ kind: "point", x: 60, y: 42, h: 16, lineH: 16 })],
  ...over,
});

describe("checkTimeline", () => {
  it("passes a clean one", () => {
    expect(checkTimeline(timeline({}))).toEqual([]);
  });

  it("finds two texts on one another", () => {
    expect(
      checkTimeline(timeline({ texts: [text({}), text({ x: 60, y: 30 })] })),
    ).toEqual(['event "Pilot" and event "Pilot": overlap']);
  });

  it("finds a text the line runs through", () => {
    expect(checkTimeline(timeline({ texts: [text({ y: 50 })] }))).toEqual([
      'event "Pilot": a line runs through it',
    ]);
  });

  it("finds a text past the canvas, or past its own box", () => {
    expect(checkTimeline(timeline({ texts: [text({ x: 280 })] }))).toEqual([
      'event "Pilot": runs past the canvas',
    ]);
    expect(
      checkTimeline(timeline({ texts: [text({ lines: ["Pilot", "Beta"] })] })),
    ).toEqual(['event "Pilot Beta": its lines overflow its box']);
    expect(
      checkTimeline(
        timeline({ texts: [text({ lines: ["Rollout everywhere"] })] }),
      ),
    ).toEqual([
      'event "Rollout everywhere": "Rollout everywhere" overflows its box',
    ]);
  });

  it("finds a dot off the line", () => {
    expect(checkTimeline(timeline({ dots: [{ x: 60, y: 70, r: 4 }] }))).toEqual(
      ["dot 0: off the line"],
    );
  });
});

describe("checkQuadrant", () => {
  it("passes a clean one", () => {
    expect(checkQuadrant(quadrant({}))).toEqual([]);
  });

  it("finds a label across an axis or the frame", () => {
    const over = text({ kind: "point", x: 100, y: 42, h: 16, lineH: 16 });
    expect(checkQuadrant(quadrant({ texts: [over] }))).toEqual([
      'point "Pilot": crosses an axis or the frame',
    ]);
    const out = text({ kind: "point", x: 4, y: 42, h: 16, lineH: 16 });
    expect(checkQuadrant(quadrant({ texts: [out] }))).toEqual([
      'point "Pilot": crosses an axis or the frame',
    ]);
  });

  it("finds a label over a dot", () => {
    expect(
      checkQuadrant(
        quadrant({
          dots: [
            { x: 50, y: 50, r: 4, focus: false },
            { x: 70, y: 50, r: 4, focus: false },
          ],
        }),
      ),
    ).toEqual(['point "Pilot": over dot 1']);
  });

  it("finds a leader through a text or a dot", () => {
    expect(
      checkQuadrant(
        quadrant({
          dots: [
            { x: 50, y: 50, r: 4, focus: false },
            { x: 75, y: 90, r: 4, focus: false },
          ],
          leaders: [{ x1: 75, y1: 30, x2: 75, y2: 100 }],
        }),
      ),
    ).toEqual([
      'leader 0: runs through point "Pilot"',
      "leader 0: runs through dot 1",
    ]);
  });

  it("finds a dot outside the plot", () => {
    expect(
      checkQuadrant(
        quadrant({
          dots: [{ x: 230, y: 50, r: 4, focus: false }],
          texts: [],
        }),
      ),
    ).toEqual(["dot 0: outside the plot"]);
  });
});
