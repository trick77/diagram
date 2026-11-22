import type { TimelineIR } from "./ir";
import {
  at,
  eyebrow,
  longestWord,
  measure,
  type PlotText,
  type TextStyle,
} from "./plot";
import { ramp } from "./theme";

/**
 * Where everything on a timeline goes, in one of two orientations.
 *
 * Flat: one baseline, a dot per period at equal steps, its labels above
 * and below the line by turns, joined to the dot by a hairline drop, so
 * neighbours never share a side and a label may run past the next dot.
 * The step comes from the labels: five short periods lie flat in a 720px
 * text column, long ones need more.
 * Standing: one vertical line, a dot per period, the period's name to its
 * left, set flush against it, and what happened to its right.
 *
 * Which one is the width's to say alone: flat when the drawing fits the
 * width it is shown in, standing otherwise, and standing when no width is
 * known, because it fits any column. Never flat and scaled down: it would
 * read smaller than the text around it.
 *
 * Equal steps, because the source names periods rather than dating them;
 * an honest scale waits for a source that carries dates.
 */

export type Segment = { x1: number; y1: number; x2: number; y2: number };
export type Dot = { x: number; y: number; r: number };
export type TimelineLayout = {
  width: number;
  height: number;
  orient: "horizontal" | "vertical";
  /** The width the flat drawing takes: shown at this width or wider, the
   * timeline lies flat. A consumer re-draws when its room crosses it. */
  wide: number;
  /** The baseline, or the standing line. */
  line: Segment;
  dots: Dot[];
  /** Flat only: the hairline from each dot towards its labels. */
  drops: Segment[];
  /** Flat only: the rule under a section's name, over its columns. */
  rules: Segment[];
  texts: PlotText[];
};

const margin = 32;
/** The least step between two dots, flat, and the widest a label runs
 * before it wraps. */
export const minStep = 120;
const labelMax = 180;
/** Clear space between two labels on one side of the line. */
const colPad = 20;
/** From the line to the nearest label, flat; the drop stops short of
 * both. */
const gap = 30;
const dropInset = 6;
const dotR = 4;
/** The baseline runs this far past the first and the last dot. */
const overhang = 40;
/** Between a period's name and its first event, and between two events. */
const nameGap = 3;
const eventGap = 4;
/** Below the title and below a row of section names. */
const titleGap = 18;
const ruleGap = 6;
/** Standing: the line to either column, the widest the columns run, the
 * space between two periods, and the line past the first and last dot. */
const side = 18;
const periodMax = 120;
const eventMax = 260;
const rowGap = 26;
const tail = 26;
/** Standing: extra space above a section's name, past the row gap. */
const sectionGap = 10;

const periodStyle: TextStyle = {
  kind: "period",
  size: ramp.label,
  lineH: 16,
  bold: true,
  role: "muted",
  track: 0,
};
const eventStyle: TextStyle = {
  kind: "event",
  size: ramp.text,
  lineH: ramp.lineHeight,
  bold: false,
  role: "fg",
  track: 0,
};
const sectionStyle: TextStyle = {
  kind: "section",
  size: ramp.label,
  lineH: 16,
  bold: true,
  role: "muted",
  track: 0.06,
};

/** layoutTimeline lays a timeline out for the width it is shown in. */
export function layoutTimeline(ir: TimelineIR, width?: number): TimelineLayout {
  const flat = horizontal(ir);
  if (width !== undefined && width >= flat.width) return flat;
  return { ...vertical(ir), wide: flat.width };
}

/** sections is each run of periods under one section name, by index. */
function sections(
  ir: TimelineIR,
): { name: string; from: number; to: number }[] {
  const out: { name: string; from: number; to: number }[] = [];
  ir.periods.forEach((p, i) => {
    const name = p.section ?? "";
    const last = out[out.length - 1];
    if (last && last.name === name && last.to === i - 1) last.to = i;
    else out.push({ name, from: i, to: i });
  });
  return out.filter((s) => s.name !== "");
}

function horizontal(ir: TimelineIR): TimelineLayout {
  const n = ir.periods.length;
  // A label wraps at labelMax, or at its longest word where that is wider:
  // a word cannot be broken.
  const max = Math.max(
    labelMax,
    ...ir.periods.flatMap((p) => [
      Math.ceil(longestWord(p.label, periodStyle)),
      ...p.events.map((e) => Math.ceil(longestWord(e, eventStyle))),
    ]),
  );
  // Each period's block: its name, then what happened, top to bottom.
  const blocks = ir.periods.map((p) => {
    const name = measure(p.label, max, periodStyle, "middle");
    const events = p.events.map((e) => measure(e, max, eventStyle, "middle"));
    const h =
      name.h +
      events.reduce((a, e) => a + e.h, 0) +
      (events.length > 0 ? nameGap + (events.length - 1) * eventGap : 0);
    const w = Math.max(name.w, ...events.map((e) => e.w));
    return { name, events, h, w };
  });
  // The step is the labels' to say: a label shares its side of the line
  // only with the period two steps on, so two steps hold half of each and
  // the space between. Every step alike, the widest pair's, and never
  // under minStep, where the dots would crowd.
  let col = minStep;
  for (let i = 0; i + 2 < n; i++)
    col = Math.max(
      col,
      Math.ceil((blocks[i].w / 2 + blocks[i + 2].w / 2 + colPad) / 2),
    );
  const first = Math.max(overhang, blocks[0].w / 2);
  const lastHalf = Math.max(overhang, blocks[n - 1].w / 2);
  const xOf = (i: number) => margin + first + col * i;
  let width = Math.ceil(xOf(n - 1) + lastHalf + margin);

  const texts: PlotText[] = [];
  let y = margin;
  if (ir.title !== "") {
    const t = measure(ir.title, Math.max(width - 2 * margin, 240), eyebrow);
    texts.push(at(t, margin, y));
    width = Math.max(width, margin + t.w + margin);
    y += t.h + titleGap;
  }
  const rules: TimelineLayout["rules"] = [];
  const secs = sections(ir);
  if (secs.length > 0) {
    const names = secs.map((s) => {
      const x1 = Math.max(margin, xOf(s.from) - col / 2 + colPad / 2);
      const x2 = Math.min(width - margin, xOf(s.to) + col / 2 - colPad / 2);
      return { t: measure(s.name, x2 - x1, sectionStyle), x1, x2 };
    });
    const h = Math.max(...names.map((s) => s.t.h));
    for (const s of names) {
      texts.push(at(s.t, s.x1, y + h - s.t.h));
      rules.push({
        x1: s.x1,
        y1: y + h + ruleGap,
        x2: s.x2,
        y2: y + h + ruleGap,
      });
    }
    y += h + ruleGap + titleGap;
  }

  const upH = Math.max(
    0,
    ...blocks.filter((_, i) => i % 2 === 0).map((b) => b.h),
  );
  const downH = Math.max(
    0,
    ...blocks.filter((_, i) => i % 2 === 1).map((b) => b.h),
  );
  const base = y + upH + gap;

  const dots: Dot[] = [];
  const drops: Segment[] = [];
  blocks.forEach((b, i) => {
    const x = xOf(i);
    const up = i % 2 === 0;
    dots.push({ x, y: base, r: dotR });
    drops.push({
      x1: x,
      y1: up ? base - dotR - 3 : base + dotR + 3,
      x2: x,
      y2: up ? base - gap + dropInset : base + gap - dropInset,
    });
    let ty = up ? base - gap - b.h : base + gap;
    texts.push(at(b.name, x - b.name.w / 2, ty));
    ty += b.name.h + nameGap;
    for (const e of b.events) {
      texts.push(at(e, x - e.w / 2, ty));
      ty += e.h + eventGap;
    }
  });
  return {
    width,
    height: base + (downH > 0 ? gap + downH : dotR) + margin,
    orient: "horizontal",
    wide: width,
    line: {
      x1: xOf(0) - overhang,
      y1: base,
      x2: xOf(n - 1) + overhang,
      y2: base,
    },
    dots,
    drops,
    rules,
    texts,
  };
}

function vertical(ir: TimelineIR): TimelineLayout {
  const names = ir.periods.map((p) =>
    measure(p.label, periodMax, periodStyle, "end"),
  );
  const events = ir.periods.map((p) =>
    p.events.map((e) => measure(e, eventMax, eventStyle)),
  );
  const nameCol = Math.max(0, ...names.map((t) => t.w));
  const lineX = margin + nameCol + side;
  const textX = lineX + side;

  const texts: PlotText[] = [];
  let y = margin;
  let title: PlotText | null = null;
  if (ir.title !== "") {
    // Measured for the widest the drawing will be anyway, so a title
    // wraps rather than widening a narrow timeline.
    title = measure(
      ir.title,
      Math.max(textX + eventMax - margin, 240),
      eyebrow,
    );
    texts.push(at(title, margin, y));
    y += title.h + titleGap;
  }
  // The line reaches past the first dot, up to here and no further: the
  // title is as wide as it likes.
  const lineTop = title ? y - titleGap / 2 : margin;
  const starts = new Set(sections(ir).map((s) => s.from));
  const dots: Dot[] = [];
  let right = textX;
  ir.periods.forEach((p, i) => {
    if (starts.has(i)) {
      if (i > 0) y += sectionGap;
      const s = measure(p.section!, eventMax, sectionStyle);
      texts.push(at(s, textX, y));
      right = Math.max(right, textX + s.w);
      y += s.h + ruleGap;
    }
    if (i === 0) y = Math.max(y, lineTop + tail - ramp.lineHeight / 2);
    const dotY = y + ramp.lineHeight / 2;
    dots.push({ x: lineX, y: dotY, r: dotR });
    const name = names[i];
    texts.push(at(name, lineX - side - name.w, dotY - periodStyle.lineH / 2));
    let ty = y;
    for (const e of events[i]) {
      texts.push(at(e, textX, ty));
      right = Math.max(right, textX + e.w);
      ty += e.h + eventGap;
    }
    const h = Math.max(
      ramp.lineHeight,
      ty - eventGap - y,
      name.h + (ramp.lineHeight - periodStyle.lineH) / 2,
    );
    y += h + rowGap;
  });
  const first = dots[0].y;
  const last = dots[dots.length - 1].y;
  const bottom = Math.max(y - rowGap, last + tail);
  return {
    width: Math.ceil(
      Math.max(right + margin, title ? margin + title.w + margin : 0),
    ),
    height: Math.ceil(bottom + margin),
    orient: "vertical",
    wide: 0,
    line: { x1: lineX, y1: first - tail, x2: lineX, y2: last + tail },
    dots,
    drops: [],
    rules: [],
    texts,
  };
}
