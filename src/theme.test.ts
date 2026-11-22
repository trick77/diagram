import { describe, it, expect } from "vitest";
import { frameOf, mix, palette, textWidth, wrap, type Palette } from "./theme";

describe("mix", () => {
  it("lays one colour over another, as hex", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#fff", "#000", 0.25)).toBe("#404040");
    expect(mix("rgb(255, 0, 0)", "#000", 1)).toBe("#ff0000");
    expect(mix("rgb(255 0 0)", "#000", 1)).toBe("#ff0000");
  });

  it("gives up on what it cannot read, so the caller keeps a role", () => {
    expect(mix("var(--diagram-fg)", "#000", 0.5)).toBeNull();
    expect(mix("#000", "teal", 0.5)).toBeNull();
    expect(mix("#000", "hsl(0 0% 50%)", 0.5)).toBeNull();
  });

  it("will not mix over a see-through colour: it would mix over black", () => {
    expect(mix("#fff", "rgba(0, 0, 0, 0)", 0.5)).toBeNull();
    expect(mix("#fff", "rgb(0 0 0 / 0.5)", 0.5)).toBeNull();
    expect(mix("#fff", "#00000080", 0.5)).toBeNull();
    expect(mix("#fff", "rgba(0, 0, 0, 1)", 0.5)).toBe("#808080");
    expect(mix("#fff", "#000000ff", 0.5)).toBe("#808080");
  });

  it("clamps what runs past a channel or a share", () => {
    expect(mix("rgb(300, 0, 0)", "#000", 1)).toBe("#ff0000");
    expect(mix("#fff", "#000", 2)).toBe("#ffffff");
  });
});

describe("frameOf", () => {
  const pal: Palette = {
    surface: "#151514",
    fg: "#ece8df",
    muted: "#a29e94",
    line: "#3b3935",
    tint: "#201f1c",
    accent: "#d97757",
    warn: "#e3a33f",
    sans: "s",
    mono: "m",
  };
  it("frames a box in 45% of the text over the surface", () => {
    expect(frameOf(pal)).toBe("#76746f");
  });
  it("falls back on the arrows' muted where the palette is var()s", () => {
    expect(frameOf({ ...pal, fg: "var(--diagram-fg)" })).toBe(pal.muted);
  });
});

describe("palette", () => {
  it("reads every role off the document, and keeps a var() for a token it lacks", () => {
    document.documentElement.style.setProperty("--diagram-surface", "#151514");
    const p = palette();
    expect(p.surface).toBe("#151514");
    expect(p.warn).toBe("var(--diagram-warn)");
    document.documentElement.style.removeProperty("--diagram-surface");
  });
});

describe("textWidth", () => {
  it("costs a wide character 1em and a mark nothing", () => {
    expect(textWidth("ab", 10, "mono")).toBe(12);
    expect(textWidth("결제", 10, "sans")).toBe(20);
    expect(textWidth("é", 10, "mono")).toBe(6);
  });
});

describe("textWidth for capitals", () => {
  it("budgets a sans capital wider than a lowercase letter, the mono alike", () => {
    expect(textWidth("A", 100, "sans")).toBeCloseTo(68);
    expect(textWidth("a", 100, "sans")).toBeCloseTo(56);
    expect(textWidth("A", 100, "mono")).toBeCloseTo(60);
  });
});

describe("textWidth for digits", () => {
  it("budgets a sans 0-9 at its measured 0.60em, the mono alike", () => {
    expect(textWidth("0123456789", 100, "sans")).toBeCloseTo(600);
    // Only 0-9 measured: another script's digit keeps the lowercase budget.
    expect(textWidth("٣", 100, "sans")).toBeCloseTo(56);
    expect(textWidth("v2", 100, "sans")).toBeCloseTo(116);
    expect(textWidth("0123456789", 100, "mono")).toBeCloseTo(600);
    expect(textWidth("０", 100, "sans")).toBeCloseTo(100);
  });
});

describe("textWidth with tracking", () => {
  it("adds the letter-spacing per character", () => {
    expect(textWidth("ab", 10, "mono", 0.1)).toBeCloseTo(14);
    expect(wrap("yes and no", 30, 10, "mono", 0.1)).toEqual([
      "yes",
      "and",
      "no",
    ]);
  });
});

describe("wrap", () => {
  it("breaks at spaces within the width and keeps the label's own breaks", () => {
    expect(wrap("Schwellenwert überschritten?", 100, 13, "sans")).toEqual([
      "Schwellenwert",
      "überschritten?",
    ]);
    expect(wrap("one\ntwo", 500, 13, "sans")).toEqual(["one", "two"]);
    expect(wrap("short", 500, 13, "sans")).toEqual(["short"]);
  });
});
