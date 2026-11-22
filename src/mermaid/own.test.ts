import { beforeAll, describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { toIR } from "./ir";
import { escapeAngles, repair } from "./text";
import { unsafeSvg } from "./guard";
import { drawIR } from "../render";
import type { Palette } from "../theme";

// The package's own drawing is not gated: every IR text reaches the SVG as
// escaped text, never as an attribute that loads. Held here over every
// kind, with every text a model writes set to what would fetch.
const bad =
  'url(https://evil.example/x) <image href="https://evil.example/y"/>';
const q = `"${bad.replace(/"/g, "'")}"`;

const pal: Palette = {
  surface: "#000",
  fg: "#fff",
  muted: "#888",
  line: "#444",
  tint: "#111",
  accent: "#f80",
  warn: "#fc0",
  sans: "sans-serif",
  mono: "monospace",
};

const sources: [string, string][] = [
  ["flow", `flowchart TD\n  a[${q}] -->|${q}| b{${q}}\n  b --> c[${q}]`],
  [
    "zones",
    `flowchart LR\n  subgraph s1[${q}]\n    a[${q}]\n  end\n  subgraph s2[${q}]\n    b[${q}]\n  end\n  a --> b`,
  ],
  [
    "sequence",
    `sequenceDiagram\n  participant A as ${bad}\n  A->>B: ${bad}\n  Note over A: ${bad}`,
  ],
  ["state", `stateDiagram-v2\n  [*] --> A\n  A : ${bad}\n  A --> B : ${bad}`],
  ["er", `erDiagram\n  A ||--o{ B : ${q}\n  A {\n    string name ${q}\n  }`],
  [
    "class",
    `classDiagram\n  class A {\n    +String src https://evil.example/x\n    +load(https://evil.example/y) url\n  }\n  A <|-- B : href url(evil.example)`,
  ],
  ["mindmap", `mindmap\n  root((${q}))\n    a[${q}]\n      b[${q}]`],
  ["timeline", `timeline\n  title ${bad}\n  2024 : ${bad}`],
  [
    "quadrant",
    `quadrantChart\n  title ${q}\n  x-axis Low --> High\n  y-axis Low --> High\n  P: [0.3, 0.6]`,
  ],
];

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
});

describe("the package's own drawing", () => {
  for (const [kind, src] of sources)
    it(`writes a ${kind}'s texts as text`, async () => {
      const text = escapeAngles(repair(src));
      const d = await mermaid.mermaidAPI.getDiagramFromText(text);
      const ir = toIR(d.type, d.db);
      expect(ir, kind).not.toBeNull();
      const { svg } = await drawIR(ir!, "t", { palette: pal });
      expect(unsafeSvg(svg)).toBeNull();
      expect(svg).not.toMatch(/<image/);
    });
});
