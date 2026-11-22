import { describe, it, expect, vi, beforeEach } from "vitest";

// The renderer measures text with getBBox, which jsdom lacks, so the tests
// stand in for it: parse accepts anything that does not say `bad`, and
// render answers with a marked SVG. What is under test is what draw.ts does
// around the renderer: source selection, the cache, the fallbacks. Like the
// real one, parse answers false rather than throwing when asked to suppress
// errors.
type ParseOpts = { suppressErrors?: boolean };
const refuse = (src: string, opts?: ParseOpts) => {
  if (opts?.suppressErrors) return false;
  throw new Error(`Parse error on line ${src.includes("bad") ? 1 : 2}`);
};
const defaultParse = async (src: string, opts?: ParseOpts) => {
  if (src.includes("bad")) return refuse(src, opts);
  return { diagramType: src.split(/\s+/)[0] };
};
const parse = vi.fn(defaultParse);
const renderSvg = vi.fn(async (id: string, src: string) => ({
  svg: `<svg id="${id}" data-src="${src.length}"><g class="drawn"></g></svg>`,
}));
const initialize = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: (c: unknown) => initialize(c),
    parse: (s: string, o?: ParseOpts) => parse(s, o),
    render: (i: string, s: string) => renderSvg(i, s),
  },
}));

// The own drawing stands aside by default, so the tests keep asserting on
// the renderer; the ones about it say what it returns.
const editorial = vi.fn(
  async (
    _m: unknown,
    _src: string,
    _ids: string,
    _limits?: unknown,
  ): Promise<string | null> => null,
);
vi.mock("./editorial", () => ({
  editorial: (m: unknown, s: string, i: string, l?: unknown) =>
    editorial(m, s, i, l),
}));

import {
  configure,
  diagramTitle,
  draw,
  drawnNow,
  themeVariables,
  titles,
} from "./draw";
import { diagramKind } from "./kind";

beforeEach(() => {
  parse.mockReset();
  parse.mockImplementation(defaultParse);
  renderSvg.mockClear();
  editorial.mockReset();
  editorial.mockResolvedValue(null);
});

const last = <T>(a: T[]): T => a[a.length - 1];

describe("configure", () => {
  // First, before any draw has loaded the renderer: it reads its theme once.
  it("names the drawings and themes the renderer as the app says", async () => {
    configure({
      ids: "app-diagram",
      themeVariables: () => ({ fontFamily: "Plex" }),
      limits: { nodes: 4 },
    });
    await draw("flowchart TD\n configured --> here");
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        themeVariables: { fontFamily: "Plex" },
        fontFamily: "Plex",
      }),
    );
    expect(last(editorial.mock.calls)[2]).toMatch(/^app-diagram-\d+$/);
    expect(last(editorial.mock.calls)[3]).toEqual({ nodes: 4 });
    expect(last(renderSvg.mock.calls)[0]).toMatch(/^app-diagram-\d+$/);
  });
});

describe("the own drawing", () => {
  it("draws a source it covers itself, on its own parse alone", async () => {
    editorial.mockResolvedValueOnce('<svg data-own="1"></svg>');
    const out = await draw("flowchart TD\n own --> one");
    expect(out).toEqual({ svg: '<svg data-own="1"></svg>', own: true });
    expect(parse).not.toHaveBeenCalled();
    expect(renderSvg).not.toHaveBeenCalled();
  });

  it("drops a class mark standing alone on a line before anything reads the source", async () => {
    editorial.mockResolvedValueOnce('<svg data-own="1"></svg>');
    await draw("flowchart TD\n  a --> b:::focus\n:::focus");
    expect(last(editorial.mock.calls)[1]).toBe(
      "flowchart TD\n  a --> b:::focus",
    );
  });

  it("leaves a flowchart it cannot parse to the renderer's refusal", async () => {
    editorial.mockRejectedValueOnce(new Error("Parse error"));
    const out = await draw("flowchart TD\n bad -->");
    expect(out).toEqual({ error: "Parse error on line 1" });
  });

  it("lets the renderer draw what it declines", async () => {
    const out = await draw("flowchart TD\n declined --> here");
    expect(out).toEqual({ svg: expect.stringContaining("drawn") });
    expect(renderSvg).toHaveBeenCalled();
  });

  it("never loads its drawing for a kind it does not draw", async () => {
    await draw('pie\n "a" : 1');
    expect(editorial).not.toHaveBeenCalled();
  });

  it("lets the renderer draw when its own drawing throws", async () => {
    editorial.mockRejectedValueOnce(new Error("layout blew up"));
    const out = await draw("flowchart TD\n throws --> here");
    expect(out).toEqual({ svg: expect.stringContaining("drawn") });
  });
});

describe("draw and angle brackets", () => {
  it("draws the source as written when the escaped one does not parse", async () => {
    // The renderer refuses the escaped text, every time it is asked.
    parse.mockImplementation(async (s: string, o?: ParseOpts) =>
      s.includes("#lt;") ? refuse(s, o) : { diagramType: "sequenceDiagram" },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const src = "sequenceDiagram\n  A->>B: List<Order> back";
    const out = await draw(src);
    expect(out).toEqual({ svg: expect.stringContaining("drawn") });
    expect(renderSvg).toHaveBeenLastCalledWith(expect.any(String), src);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not fall back, nor keep the result, when the escaped text parses but drawing fails", async () => {
    renderSvg.mockRejectedValueOnce(new Error("chunk gone"));
    const src = "sequenceDiagram\n  A->>B: Map<K> once";
    expect(await draw(src)).toEqual({ error: "chunk gone" });
    // The next attempt draws, with its brackets.
    expect(await draw(src)).toEqual({ svg: expect.stringContaining("drawn") });
    expect(renderSvg).toHaveBeenLastCalledWith(
      expect.any(String),
      "sequenceDiagram\n  A->>B: Map#lt;K#gt; once",
    );
  });

  it("quotes the source as written when neither parses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await draw("sequenceDiagram\n  bad A->>B: List<Order>");
    expect(out).toEqual({ error: "Parse error on line 1" });
    expect(parse).toHaveBeenLastCalledWith(
      "sequenceDiagram\n  bad A->>B: List<Order>",
      undefined,
    );
    warn.mockRestore();
  });
});

// A card mounting again (a list re-rendered, a thread reopened) shows its
// finished drawing in its first render, not a placeholder for a tick.
describe("drawnNow", () => {
  it("is nothing before a drawing is done, then the drawing itself", async () => {
    const src = "flowchart LR\n now --> later";
    expect(drawnNow(src)).toBeNull();
    const p = draw(src);
    expect(drawnNow(src)).toBeNull();
    const d = await p;
    expect(drawnNow(src)).toBe(d);
    // A room changes nothing for a kind that does not depend on it.
    expect(drawnNow(src, { width: 480 })).toBe(d);
  });

  it("never hands out a refusal", async () => {
    const src = "flowchart LR\n bad[ now";
    expect(await draw(src)).toEqual({ error: "Parse error on line 1" });
    expect(drawnNow(src)).toBeNull();
  });
});

describe("draw", () => {
  it("renders a source once, however often it is asked for", async () => {
    const src = "flowchart LR\n once --> twice";
    const a = await draw(src);
    const b = await draw(src);
    expect(a).toBe(b);
    expect(renderSvg).toHaveBeenCalledTimes(1);
  });

  it("answers a refused source with the parser's complaint, not a throw", async () => {
    const out = await draw("flowchart LR\n bad[");
    expect(out).toEqual({ error: "Parse error on line 1" });
    expect(renderSvg).not.toHaveBeenCalled();
  });

  it("keeps a drawing but not a refusal, so a chunk that failed to load is tried again", async () => {
    await draw("flowchart LR\n bad[ again");
    await draw("flowchart LR\n bad[ again");
    expect(parse).toHaveBeenCalledTimes(2);
  });
});

describe("diagramKind and diagramTitle", () => {
  it("reads the type off the first word, past directives and blank lines", () => {
    expect(diagramKind("flowchart LR\n a-->b")).toBe("flowchart");
    expect(diagramKind("\n%%{init: {}}%%\nsequenceDiagram\n A->>B: x")).toBe(
      "sequenceDiagram",
    );
    expect(diagramKind("stateDiagram-v2\n [*] --> A")).toBe("stateDiagram-v2");
    expect(diagramKind("")).toBe("");
    expect(diagramKind('{"type":"flow"}')).toBe("");
  });

  // mermaid's front matter (`---`, YAML, `---`) read as the type word gave
  // "" and every such diagram went to the renderer, unnamed.
  it("reads the type past YAML front matter, and its title as the name", () => {
    const src =
      "---\ntitle: Order flow\nconfig:\n  look: classic\n---\nflowchart TD\n a --> b";
    expect(diagramKind(src)).toBe("flowchart");
    expect(diagramTitle(src)).toBe("Order flow");
    expect(
      diagramTitle('---\ntitle: "Quoted: yes"\n---\nflowchart TD\n a'),
    ).toBe("Quoted: yes");
    // No title, or an unclosed block: the type's name, as before.
    expect(
      diagramTitle("---\nconfig: {}\n---\nsequenceDiagram\n A->>B: x"),
    ).toBe("Sequence diagram");
    expect(diagramKind("---\ntitle: x\nflowchart TD")).toBe("");
  });

  it("names the picture by its type and falls back to Diagram", () => {
    expect(diagramTitle("flowchart TD\n a")).toBe("Flow diagram");
    expect(diagramTitle("graph LR\n a")).toBe("Flow diagram");
    expect(diagramTitle("sequenceDiagram\n A->>B: x")).toBe("Sequence diagram");
    expect(diagramTitle("stateDiagram-v2\n a")).toBe("State diagram");
    expect(diagramTitle("erDiagram\n A ||--o{ B : has")).toBe("Entity diagram");
    expect(diagramTitle("classDiagram\n class A")).toBe("Class diagram");
    expect(diagramTitle("gantt\n title x")).toBe("Diagram");
  });

  it("names it in the app's language when given its names", () => {
    const de = { ...titles, flowchart: "Flussdiagramm" };
    expect(diagramTitle("flowchart TD\n a", de, "Diagramm")).toBe(
      "Flussdiagramm",
    );
    expect(diagramTitle("gantt\n title x", de, "Diagramm")).toBe("Diagramm");
  });
});

describe("themeVariables", () => {
  // The tokens live in the app's stylesheet, which jsdom does not load, so
  // the test sets the handful it asserts on directly. An inline custom
  // property resolves through getComputedStyle, which is the path
  // themeVariables reads.
  const tokens: Record<string, string> = {
    "--color-panel": "#1b1b1a",
    "--color-border": "#323230",
    "--color-border-soft": "#2a2a28",
    "--color-faint": "#6f6d66",
    "--color-muted": "#9c9a92",
  };

  beforeEach(() => {
    for (const [name, value] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(name, value);
    }
    return () => {
      for (const name of Object.keys(tokens)) {
        document.documentElement.style.removeProperty(name);
      }
    };
  });

  // A frame is only a frame if it reads against the fill it sits on. The
  // border token is a chrome value, where it separates a panel from the page
  // ground; against a node fill four points away from it, it draws nothing.
  it("draws every frame in a colour that reads on the fill", () => {
    const vars = themeVariables();
    for (const key of [
      "primaryBorderColor",
      "secondaryBorderColor",
      "actorBorder",
      "labelBoxBorderColor",
      "clusterBorder",
    ]) {
      expect(vars[key]).toBe(tokens["--color-faint"]);
    }
  });

  // Quieter than the arrows, so the flow stays the loudest thing drawn.
  it("keeps the frames quieter than the lines between them", () => {
    const vars = themeVariables();
    expect(vars.lineColor).toBe(tokens["--color-muted"]);
    expect(vars.primaryBorderColor).not.toBe(vars.lineColor);
  });

  // loom has no ochre tokens: a note then took the renderer's own yellow.
  describe("without the ochre tokens", () => {
    const set = (name: string, v: string) =>
      document.documentElement.style.setProperty(name, v);
    beforeEach(() => {
      set("--diagram-warn", "#e3a33f");
      return () => {
        for (const n of [
          "--diagram-warn",
          "--color-ochre",
          "--color-ochre-wash",
        ])
          document.documentElement.style.removeProperty(n);
      };
    });

    it("draws notes in the warn role, on a wash of it", () => {
      const vars = themeVariables();
      expect(vars.noteBorderColor).toBe("#e3a33f");
      expect(vars.tertiaryBorderColor).toBe("#e3a33f");
      expect(vars.noteBkgColor).toBe("rgba(227, 163, 63, 0.14)");
      expect(vars.tertiaryColor).toBe("rgba(227, 163, 63, 0.14)");
    });

    it("reads a short hex and an rgb() warn too, and leaves a wash it cannot derive", () => {
      set("--diagram-warn", "#fa0");
      expect(themeVariables().noteBkgColor).toBe("rgba(255, 170, 0, 0.14)");
      set("--diagram-warn", "rgb(1, 2, 3)");
      expect(themeVariables().noteBkgColor).toBe("rgba(1, 2, 3, 0.14)");
      set("--diagram-warn", "orange");
      const vars = themeVariables();
      expect(vars.noteBorderColor).toBe("orange");
      expect(vars.noteBkgColor).toBeUndefined();
    });

    it("keeps the ochre tokens where the page has them", () => {
      set("--color-ochre", "#d6a15a");
      set("--color-ochre-wash", "rgba(214, 161, 90, 0.14)");
      const vars = themeVariables();
      expect(vars.noteBorderColor).toBe("#d6a15a");
      expect(vars.noteBkgColor).toBe("rgba(214, 161, 90, 0.14)");
    });
  });
});
