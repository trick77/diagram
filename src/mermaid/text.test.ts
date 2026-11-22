import { beforeAll, describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { dropStrayMarks, escapeAngles, repair } from "./text";
import { toIR } from "./ir";
import type { FlowIR } from "../ir";

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
});

/** labels draws a flowchart's escaped source through the real parse and
 * returns what the drawing would show as text. */
async function labels(src: string): Promise<string[]> {
  const d = await mermaid.mermaidAPI.getDiagramFromText(escapeAngles(src));
  const ir = toIR(d.type, d.db) as FlowIR;
  return [
    ...ir.nodes.map((n) => n.label),
    ...ir.edges.map((e) => e.label).filter((l) => l !== ""),
    ...ir.zones.map((z) => z.title),
  ];
}

/** parses says the real renderer accepts the escaped source. */
async function parses(src: string): Promise<boolean> {
  return !!(await mermaid.parse(escapeAngles(src), { suppressErrors: true }));
}

// Shapes models wrote that the renderer refuses, each repaired to what the
// model meant; the corpus holds a full diagram of each.
describe("repair", () => {
  async function refused(src: string): Promise<boolean> {
    return !(await mermaid.parse(src, { suppressErrors: true }));
  }

  it("joins a mark spaced off its node's shape", async () => {
    const src =
      'flowchart TD\n  K["In"] --> D1{"Damaged?"} :::focus\n  D1 --> X';
    expect(await refused(src)).toBe(true);
    expect(repair(src)).toBe(
      'flowchart TD\n  K["In"] --> D1{"Damaged?"}:::focus\n  D1 --> X',
    );
    expect(await refused(repair(src))).toBe(false);
  });

  it("moves a mark written inside a shape out after it", async () => {
    const src = 'flowchart TD\n  a --> b{"Picked up?" :::focus}\n  b --> c';
    expect(repair(src)).toBe(
      'flowchart TD\n  a --> b{"Picked up?"}:::focus\n  b --> c',
    );
    expect(repair("flowchart TD\n  a([Start :::focus]) --> b")).toBe(
      "flowchart TD\n  a([Start]):::focus --> b",
    );
    const d = await mermaid.mermaidAPI.getDiagramFromText(repair(src));
    const ir = toIR(d.type, d.db) as FlowIR;
    expect(ir.nodes.find((n) => n.id === "b")).toMatchObject({
      label: "Picked up?",
      focus: true,
    });
  });

  it("knows a parallelogram's and a trapezoid's closers", async () => {
    const src =
      'flowchart TD\n  a[/"Upload" :::focus/] --> b[\\Check :::focus\\]';
    expect(repair(src)).toBe(
      'flowchart TD\n  a[/"Upload"/]:::focus --> b[\\Check\\]:::focus',
    );
    expect(await refused(repair(src))).toBe(false);
  });

  it("never rewrites a quoted label's own text", () => {
    for (const src of [
      'flowchart TD\n  a["f(x :::y)"] --> b',
      'flowchart TD\n  a["x] :::y"] --> b',
    ])
      expect(repair(src)).toBe(src);
  });

  it("quotes an entity named like an erDiagram keyword", async () => {
    const src =
      "erDiagram\n  CLASS ||--o{ LESSON : books\n  TEACHER ||--o{ Class : runs\n  CLASS {\n    int id PK\n  }\n  style {\n    int id\n  }";
    expect(await refused(src)).toBe(true);
    expect(repair(src)).toBe(
      'erDiagram\n  "CLASS" ||--o{ LESSON : books\n  TEACHER ||--o{ "Class" : runs\n  "CLASS" {\n    int id PK\n  }\n  "style" {\n    int id\n  }',
    );
    expect(await refused(repair(src))).toBe(false);
  });

  it("quotes it in every place an entity stands", async () => {
    const cases: [string, string][] = [
      // A one-line block.
      [
        "erDiagram\n  CLASS { int id PK }\n  CLASS ||--o{ LESSON : x",
        'erDiagram\n  "CLASS" { int id PK }\n  "CLASS" ||--o{ LESSON : x',
      ],
      // An alias.
      [
        'erDiagram\n  CLASS["Course"] {\n    int id\n  }\n  CLASS ||--o{ LESSON : x',
        'erDiagram\n  "CLASS"["Course"] {\n    int id\n  }\n  "CLASS" ||--o{ LESSON : x',
      ],
      // No spaces around the relationship.
      [
        "erDiagram\n  CLASS||--o{LESSON : x",
        'erDiagram\n  "CLASS"||--o{LESSON : x',
      ],
      // A style names it bare: there the grammar takes it.
      [
        "erDiagram\n  CLASS ||--o{ LESSON : x\n  style CLASS fill:#f00",
        'erDiagram\n  "CLASS" ||--o{ LESSON : x\n  style CLASS fill:#f00',
      ],
    ];
    for (const [src, want] of cases) {
      expect(await refused(src), src).toBe(true);
      expect(repair(src)).toBe(want);
      expect(await refused(repair(src)), want).toBe(false);
    }
  });

  // A class statement refuses the keyword in its list, quoted or not: the
  // entity takes its class as a mark instead, the others keep the line.
  it("moves a keyword entity out of a class statement into a mark", async () => {
    const src =
      "erDiagram\n  CLASS ||--o{ LESSON : x\n  LESSON ||--o{ SEAT : y\n  class CLASS,SEAT focus";
    expect(await refused(src)).toBe(true);
    const out = repair(src);
    expect(out).toBe(
      'erDiagram\n  "CLASS":::focus ||--o{ LESSON : x\n  LESSON ||--o{ SEAT : y\n  class SEAT focus',
    );
    const d = await mermaid.mermaidAPI.getDiagramFromText(out);
    const ir = toIR(d.type, d.db);
    expect(
      ir?.kind === "er" && ir.entities.filter((e) => e.focus).map((e) => e.id),
    ).toEqual(["CLASS", "SEAT"]);
    expect(
      repair("erDiagram\n  CLASS ||--o{ LESSON : x\n  class CLASS focus"),
    ).toBe('erDiagram\n  "CLASS":::focus ||--o{ LESSON : x');
    // On the right of its relationship too.
    const right = repair(
      "erDiagram\n  TEACHER ||--o{ CLASS : runs\n  class CLASS focus",
    );
    expect(right).toBe('erDiagram\n  TEACHER ||--o{ "CLASS":::focus : runs');
    expect(await refused(right)).toBe(false);
  });

  it("leaves a well-formed source byte for byte", () => {
    for (const src of [
      'flowchart TD\n  a["x"]:::focus --> b',
      'erDiagram\n  LESSON ||--o{ "CLASS" : has',
      "erDiagram\n  LESSON { int id PK }\n  class LESSON focus",
      "sequenceDiagram\n  A->>B: hi :::focus",
    ])
      expect(repair(src)).toBe(src);
  });
});

describe("dropStrayMarks", () => {
  it("drops a line that is a class mark and nothing else, which the renderer refuses", async () => {
    const src =
      'flowchart TD\n  a["Load"] --> b["Price"]:::focus\n  b --> c\n:::focus';
    expect(await parses(src)).toBe(false);
    const out = dropStrayMarks(src);
    expect(out).toBe(
      'flowchart TD\n  a["Load"] --> b["Price"]:::focus\n  b --> c',
    );
    expect(await parses(out)).toBe(true);
  });

  it("leaves a mark on a node, and every other source, as written", () => {
    const src = "flowchart TD\n  a:::focus --> b\n  classDef focus stroke:red";
    expect(dropStrayMarks(src)).toBe(src);
    expect(dropStrayMarks("sequenceDiagram\n  A->>B: :::x")).toBe(
      "sequenceDiagram\n  A->>B: :::x",
    );
    // In a mindmap a mark on the line after a node is that node's class.
    const mind = "mindmap\n  root\n    Urgent\n    :::urgent";
    expect(dropStrayMarks(mind)).toBe(mind);
  });
});

describe("escapeAngles through the real parse", () => {
  it("keeps type parameters, whatever their case", async () => {
    expect(
      await labels(
        'flowchart LR\n  a["Repository<S>"] --> b["Map<I, V>"] --> c["List<Code>"]',
      ),
    ).toEqual(["Repository<S>", "Map<I, V>", "List<Code>"]);
  });

  it("keeps unquoted node labels, both edge label forms and a subgraph title", async () => {
    expect(
      await labels(
        "flowchart LR\n  subgraph s [Stage <n>]\n    a[Fetch <url>]\n  end\n  a -- has <n> --> b(Retry <k>)\n  b -->|x <y>| c",
      ),
    ).toEqual([
      "Fetch <url>",
      "Retry <k>",
      "c",
      "has <n>",
      "x <y>",
      "Stage <n>",
    ]);
  });

  it("never breaks a source that parsed before", async () => {
    for (const src of [
      'flowchart LR\n  a["`multi\nline <x>`"] --> b["y"]',
      'flowchart LR\n  %% a lone " in a comment\n  a["<x>"] --> b',
      'sequenceDiagram\n  A->>B: 5" screen\n  B-->>A: ok "done" <x>',
      "stateDiagram-v2\n  A --> B : retries < 3\n  Crash:::bad --> [*]",
      "classDiagram-v2\n  Repo --> Store : returns List<Item>",
      "erDiagram\n  A ||--o{ B : has <many>",
    ]) {
      expect(await parses(src), src).toBe(true);
    }
  });
});

describe("escapeAngles on what the last review found", () => {
  it("keeps a line break in any case, and reads a comparison as text", async () => {
    expect(
      await labels(
        "flowchart LR\n  a[x <BR> y] --> b[p <Br/> q] --> c[if a<b and c>d]",
      ),
    ).toEqual(["x\ny", "p\nq", "if a<b and c>d"]);
  });

  it("reads a participant named Title as a sender, not a keyword", async () => {
    const src = "sequenceDiagram\n  Title->>A: ok <x>";
    expect(escapeAngles(src)).toBe(
      "sequenceDiagram\n  Title->>A: ok #lt;x#gt;",
    );
    expect(await parses(src)).toBe(true);
  });

  it("keeps a label written into an arrow, spaced or not, with any head", async () => {
    expect(
      await labels(
        "flowchart LR\n  a -- x <y> --x b\n  b --text <z>--> c\n  c -- n > 0 --o d",
      ),
    ).toEqual(["a", "b", "c", "d", "x <y>", "text <z>", "n > 0"]);
  });

  it("keeps an asymmetric node's label and a class body's members", async () => {
    expect(await labels("flowchart LR\n  a>Flag <f>] --> b")).toEqual([
      "Flag <f>",
      "b",
    ]);
    const cls = "classDiagram\n  class Repo{\n    +List<Item> items\n  }";
    expect(escapeAngles(cls)).toBe(
      "classDiagram\n  class Repo{\n    +List#lt;Item#gt; items\n  }",
    );
    expect(await parses(cls)).toBe(true);
  });

  it("keeps a class body's stereotype a stereotype", () => {
    // Escaped, `<<interface>>` was read as a member named by its text.
    expect(
      escapeAngles(
        "classDiagram\n  class Shape {\n    <<interface>>\n    +area() Map<K, V>\n  }",
      ),
    ).toBe(
      "classDiagram\n  class Shape {\n    <<interface>>\n    +area() Map#lt;K, V#gt;\n  }",
    );
  });
});

describe("escapeAngles on the variants and shorthands", () => {
  it("leaves a :::class shorthand and its arrow alone", () => {
    expect(
      escapeAngles("stateDiagram-v2\n  Crash:::bad --> [*] : on <err>"),
    ).toBe("stateDiagram-v2\n  Crash:::bad --> [*] : on #lt;err#gt;");
  });

  it("pairs a sequence line's quotes on that line alone", () => {
    expect(
      escapeAngles('sequenceDiagram\n  A->>B: 5" screen\n  B-->>A: ok <x>'),
    ).toBe('sequenceDiagram\n  A->>B: 5" screen\n  B-->>A: ok #lt;x#gt;');
  });

  it("knows classDiagram-v2 and flowchart-elk", () => {
    expect(escapeAngles("classDiagram-v2\n  A --> B : List<I>")).toBe(
      "classDiagram-v2\n  A --> B : List#lt;I#gt;",
    );
    expect(escapeAngles("flowchart-elk LR\n  a -->|x <y>| b")).toBe(
      "flowchart-elk LR\n  a -->|x #lt;y#gt;| b",
    );
  });
});

describe("escapeAngles in a flowchart", () => {
  // An id never ends in `-`: read as `A--`, a spaceless arrow's `>` opened
  // the asymmetric shape and the next arrow was escaped into text.
  it("leaves a spaceless arrow an arrow", () => {
    expect(escapeAngles("flowchart LR\n  A-->B-->C[x <y>]")).toBe(
      "flowchart LR\n  A-->B-->C[x #lt;y#gt;]",
    );
    expect(escapeAngles("flowchart LR\n  A-->B --> C[ok <n>]")).toBe(
      "flowchart LR\n  A-->B --> C[ok #lt;n#gt;]",
    );
    // An id with a dash inside it is still one id.
    expect(escapeAngles("flowchart LR\n  a-b[x <y>]-->c")).toBe(
      "flowchart LR\n  a-b[x #lt;y#gt;]-->c",
    );
  });

  it("keeps brackets in quoted labels as text, arrows and line breaks as they are", () => {
    expect(
      escapeAngles(
        'flowchart LR\n  m2["Failed to fetch <url>: <cause>"]\n  a -->|"x <n> y"| b["one<br/>two"]',
      ),
    ).toBe(
      'flowchart LR\n  m2["Failed to fetch #lt;url#gt;: #lt;cause#gt;"]\n  a -->|"x #lt;n#gt; y"| b["one<br/>two"]',
    );
  });

  it("finds a quoted label's end across lines, never escaping the arrow after it", () => {
    expect(
      escapeAngles('flowchart LR\n  a["`multi\nline <x>`"] --> b["y"]'),
    ).toBe('flowchart LR\n  a["`multi\nline #lt;x#gt;`"] --> b["y"]');
  });

  it("escapes an unquoted edge label between pipes", () => {
    expect(escapeAngles("flowchart LR\n  a -->|retries < 3| b")).toBe(
      "flowchart LR\n  a -->|retries #lt; 3| b",
    );
  });

  it("keeps the formatting tags the renderer honours as markup", () => {
    expect(escapeAngles('flowchart TD\n  a["<b>Retry</b> <n> times"]')).toBe(
      'flowchart TD\n  a["<b>Retry</b> #lt;n#gt; times"]',
    );
  });

  it("leaves a source without angle brackets byte for byte", () => {
    const src = 'flowchart TD\n  a["x"] --> b{"y?"}';
    expect(escapeAngles(src)).toBe(src);
  });
});

describe("escapeAngles in a sequence", () => {
  it("escapes a message after its colon, never the arrow", () => {
    expect(escapeAngles("sequenceDiagram\n  A->>B: List<Order> back")).toBe(
      "sequenceDiagram\n  A->>B: List#lt;Order#gt; back",
    );
    expect(escapeAngles("sequenceDiagram\n  A<<->>B: x<y>")).toBe(
      "sequenceDiagram\n  A<<->>B: x#lt;y#gt;",
    );
  });

  it("escapes the text after a block keyword or a participant's alias", () => {
    expect(
      escapeAngles(
        "sequenceDiagram\n  participant R as Repo<T>\n  alt retries < 3\n  loop until n > 0\n  end",
      ),
    ).toBe(
      "sequenceDiagram\n  participant R as Repo#lt;T#gt;\n  alt retries #lt; 3\n  loop until n #gt; 0\n  end",
    );
  });

  it("knows the kind past a directive and a blank line", () => {
    expect(
      escapeAngles(
        '%%{init: {"theme":"base"}}%%\n\nsequenceDiagram\n  A->>B: List<Order>',
      ),
    ).toBe(
      '%%{init: {"theme":"base"}}%%\n\nsequenceDiagram\n  A->>B: List#lt;Order#gt;',
    );
  });

  it("knows the kind past front matter, and leaves the front matter as written", () => {
    expect(
      escapeAngles('---\ntitle: "A <b>"\n---\nflowchart LR\n  a["x <y>"]'),
    ).toBe('---\ntitle: "A <b>"\n---\nflowchart LR\n  a["x #lt;y#gt;"]');
  });
});

describe("escapeAngles in state, class and entity diagrams", () => {
  it("escapes a transition's label and a note's body", () => {
    expect(
      escapeAngles(
        "stateDiagram-v2\n  A --> B : retries < 3\n  note right of B\n    waits for <ack>\n  end note",
      ),
    ).toBe(
      "stateDiagram-v2\n  A --> B : retries #lt; 3\n  note right of B\n    waits for #lt;ack#gt;\n  end note",
    );
  });

  it("escapes a relation's label after its colon", () => {
    expect(
      escapeAngles("classDiagram\n  Repo --> Store : returns List<Item>"),
    ).toBe("classDiagram\n  Repo --> Store : returns List#lt;Item#gt;");
    expect(escapeAngles("erDiagram\n  A ||--o{ B : has <many>")).toBe(
      "erDiagram\n  A ||--o{ B : has #lt;many#gt;",
    );
  });
});
