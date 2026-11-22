import { beforeAll, describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { toIR } from "./ir";
import { escapeAngles } from "./text";
import { fits } from "../fits";
import type {
  ClassDiagramIR,
  ERIR,
  FlowIR,
  SequenceIR,
  SwimlaneIR,
} from "../ir";

// The renderer registers its diagram types on initialize; draw.ts does the
// same before its first parse.
beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
});

async function ir(src: string) {
  const d = await mermaid.mermaidAPI.getDiagramFromText(src);
  return toIR(d.type, d.db);
}

async function flow(src: string): Promise<FlowIR> {
  const out = await ir(src);
  expect(out).not.toBeNull();
  expect(out!.kind).toBe("flow");
  return out as FlowIR;
}

describe("toIR for a flowchart", () => {
  it("reads nodes in the order they were written, with their shape", async () => {
    const f = await flow(`flowchart TD
  a(["Answer()"]) --> b{"sources empty?"}
  b -->|"yes"| c(["NothingFound"])
  b --> d["Stream"]
  d --> e(("dot"))
  e --> f[(Store)]`);
    expect(f.direction).toBe("TB");
    expect(f.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["a", "Answer()", "pill"],
      ["b", "sources empty?", "decision"],
      ["c", "NothingFound", "pill"],
      ["d", "Stream", "step"],
      ["e", "dot", "pill"],
      ["f", "Store", "step"],
    ]);
  });

  it("keeps edge labels and says how the edge is drawn", async () => {
    const f = await flow(`flowchart LR
  a --> b
  b -- Nein --> c
  c -.-> d
  d --- e
  e <--> a
  a ~~~ c`);
    expect(f.direction).toBe("LR");
    expect(f.edges).toEqual([
      { from: "a", to: "b", label: "", dashed: false, head: "end" },
      { from: "b", to: "c", label: "Nein", dashed: false, head: "end" },
      { from: "c", to: "d", label: "", dashed: true, head: "end" },
      { from: "d", to: "e", label: "", dashed: false, head: "none" },
      { from: "e", to: "a", label: "", dashed: false, head: "both" },
    ]);
  });

  it("takes a node with no label as its id, and a bare id as a step", async () => {
    const f = await flow(`flowchart TD
  start --> stop`);
    expect(f.nodes).toEqual([
      { id: "start", label: "start", shape: "step" },
      { id: "stop", label: "stop", shape: "step" },
    ]);
  });

  it("marks a node the model tagged as the focus", async () => {
    const f = await flow(`flowchart TD
  a["Gather"] --> b["Rerank"]:::focus
  classDef focus stroke-width:2px`);
    expect(f.nodes.map((n) => n.focus ?? false)).toEqual([false, true]);
  });

  it("shows entities and markdown as mermaid's own drawing did", async () => {
    const f = await flow(`flowchart TD
  a["Salt &amp; Pepper &lt; 3"] --> b["say #quot;hi#quot; #35;1"]
  b -- "a &amp; b" --> c[\`**bold** md\`]
  subgraph s ["R&amp;D"]
    d
  end`);
    expect(f.nodes.map((n) => n.label)).toEqual([
      "Salt & Pepper < 3",
      'say "hi" #1',
      "bold md",
      "d",
    ]);
    expect(f.edges[1].label).toBe("a & b");
    expect(f.zones[0].title).toBe("R&D");
  });

  it("keeps no zone for a subgraph holding no node", async () => {
    const f = await flow(`flowchart TD
  a --> b
  subgraph empty
  end`);
    expect(f.zones).toEqual([]);
  });

  it("reads a line break as a line break and drops markup", async () => {
    const f = await flow(`flowchart TD
  a["one<br/>two <b>bold</b>"]`);
    expect(f.nodes[0].label).toBe("one\ntwo bold");
  });

  it("puts subgraph members in a zone named by its title", async () => {
    const f = await flow(`flowchart LR
  subgraph Ereignis
    e1["Antrag"]
  end
  subgraph t [Topic]
    t1["Benachrichtigung"]
  end
  e1 --> t1`);
    expect(f.zones).toEqual([
      { id: "Ereignis", title: "Ereignis" },
      { id: "t", title: "Topic" },
    ]);
    expect(f.nodes.map((n) => n.zone)).toEqual(["Ereignis", "t"]);
  });

  it("declines bottom-up and right-to-left rather than drawing their mirror", async () => {
    expect(await ir("flowchart BT\n  base --> top")).toBeNull();
    expect(await ir("flowchart RL\n  a --> b")).toBeNull();
  });

  it("declines a subgraph inside a subgraph", async () => {
    expect(
      await ir(`flowchart TD
  subgraph outer
    subgraph inner
      a
    end
  end`),
    ).toBeNull();
  });

  it("declines an edge to a subgraph", async () => {
    expect(
      await ir(`flowchart TD
  subgraph s
    a
  end
  b --> s`),
    ).toBeNull();
  });
});

async function sequence(src: string): Promise<SequenceIR> {
  const out = await ir(src);
  expect(out).not.toBeNull();
  expect(out!.kind).toBe("sequence");
  return out as SequenceIR;
}

describe("toIR for a sequence", () => {
  it("reads participants in order, by their alias", async () => {
    const s = await sequence(`sequenceDiagram
  participant UI as Cart.tsx
  actor U
  UI->>U: hi
  U->>Z: undeclared`);
    expect(s.actors).toEqual([
      { id: "UI", label: "Cart.tsx" },
      { id: "U", label: "U" },
      { id: "Z", label: "Z" },
    ]);
  });

  it("says how each arrow is drawn", async () => {
    const s = await sequence(`sequenceDiagram
  A->>B: call
  B-->>A: back
  A-)B: async
  A--)B: async back
  A->B: open
  A-->B: dotted open
  A-xB: lost
  A--xB: lost back
  A<<->>B: both
  A<<-->>B: both back`);
    expect(
      s.rows.map((r) => (r.type === "message" ? [r.line, r.head] : r.type)),
    ).toEqual([
      ["solid", "filled"],
      ["dashed", "filled"],
      ["solid", "open"],
      ["dashed", "open"],
      ["solid", "none"],
      ["dashed", "none"],
      ["solid", "cross"],
      ["dashed", "cross"],
      ["solid", "both"],
      ["dashed", "both"],
    ]);
  });

  it("keeps a message's text, a self message and a note", async () => {
    const s = await sequence(`sequenceDiagram
  participant A
  participant B
  A->>A: think #amp; wait
  Note over A,B: spans both
  Note left of A: left
  Note right of B: right<br/>two`);
    expect(s.rows).toEqual([
      {
        type: "message",
        from: "A",
        to: "A",
        label: "think & wait",
        line: "solid",
        head: "filled",
      },
      { type: "note", from: "A", to: "B", side: "over", label: "spans both" },
      { type: "note", from: "A", to: "A", side: "left", label: "left" },
      { type: "note", from: "B", to: "B", side: "right", label: "right\ntwo" },
    ]);
  });

  it("reads frames as a start, its dividers and an end", async () => {
    const s = await sequence(`sequenceDiagram
  par fetch
    A->>B: one
  and
    A->>C: two
  end
  alt ok
    B-->>A: yes
  else failed
    B-->>A: no
  end
  loop every 5s
    A->>B: ping
  end
  opt cached
    A->>B: hit
  end
  critical lock
    A->>B: take
  option timeout
    A->>B: give up
  end
  break empty
    A->>B: stop
  end`);
    expect(
      s.rows
        .filter((r) => r.type !== "message" && r.type !== "note")
        .map((r) =>
          r.type === "end" ? "end" : `${r.type} ${r.keyword} ${r.label}`,
        ),
    ).toEqual([
      "frame par fetch",
      "divider and ",
      "end",
      "frame alt ok",
      "divider else failed",
      "end",
      "frame loop every 5s",
      "end",
      "frame opt cached",
      "end",
      "frame critical lock",
      "divider option timeout",
      "end",
      "frame break empty",
      "end",
    ]);
  });

  it("ignores activations, which change nothing it draws", async () => {
    const s = await sequence(`sequenceDiagram
  A->>+B: go
  activate A
  B-->>-A: done
  deactivate A`);
    expect(s.rows.map((r) => r.type)).toEqual(["message", "message"]);
  });

  it("draws a sequence whose numbering is switched off", async () => {
    const s = await sequence(`sequenceDiagram
  autonumber off
  A->>B: x`);
    expect(s.rows.map((r) => r.type)).toEqual(["message"]);
  });

  it("reads frames inside frames, three deep", async () => {
    const s = await sequence(`sequenceDiagram
  loop again
    alt ok
      opt cached
        A->>B: x
      end
    else failed
      B-->>A: y
    end
  end`);
    expect(s.rows.map((r) => r.type)).toEqual([
      "frame",
      "frame",
      "frame",
      "message",
      "end",
      "divider",
      "message",
      "end",
      "end",
    ]);
  });

  it("declines frames four deep", async () => {
    expect(
      await ir(`sequenceDiagram
  loop a
    loop b
      loop c
        loop d
          A->>B: x
        end
      end
    end
  end`),
    ).toBeNull();
  });

  it("declines what it has no drawing for", async () => {
    const declined = [
      "rect rgb(1, 2, 3)\n  A->>B: x\n  end",
      "autonumber\n  A->>B: x",
      "box Aqua Group\n  participant A\n  end\n  A->>B: x",
      "A->>B: x\n  create participant C\n  B->>C: hi",
      "par_over both\n  A->>B: x\n  end",
      "title Checkout\n  A->>B: x",
    ];
    for (const body of declined) {
      expect(await ir(`sequenceDiagram\n  ${body}`), body).toBeNull();
    }
  });
});

describe("fits a sequence", () => {
  const src = (actors: number, rows: number) =>
    "sequenceDiagram\n" +
    Array.from({ length: actors }, (_, i) => `  participant p${i}`).join("\n") +
    "\n" +
    Array.from({ length: rows }, (_, i) => `  p0->>p1: m${i}`).join("\n");

  it("draws up to eight participants and twenty rows", async () => {
    expect(fits(await sequence(src(8, 20)))).toBe(true);
    expect(fits(await sequence(src(9, 2)))).toBe(false);
    expect(fits(await sequence(src(2, 21)))).toBe(false);
  });
});

describe("toIR for a state diagram", () => {
  it("reads states as steps, [*] as a start and a stop, transitions as labelled arrows", async () => {
    const f = await flow(`stateDiagram-v2
  [*] --> Draft
  Draft --> Shared : share()
  state check <<choice>>
  Shared --> check
  check --> Archived : old
  Archived --> [*]
  Draft : a draft #lt;T#gt;
  class Shared focus`);
    expect(f.direction).toBe("TB");
    expect(f.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["root_start", "", "start"],
      ["Draft", "a draft <T>", "step"],
      ["Shared", "Shared", "step"],
      ["check", "", "decision"],
      ["Archived", "Archived", "step"],
      ["root_end", "", "stop"],
    ]);
    expect(f.nodes.find((n) => n.id === "Shared")!.focus).toBe(true);
    expect(f.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ["root_start", "Draft", ""],
      ["Draft", "Shared", "share()"],
      ["Shared", "check", ""],
      ["check", "Archived", "old"],
      ["Archived", "root_end", ""],
    ]);
    expect(f.zones).toEqual([]);
  });

  it("drops the quotes a model writes around a whole label, keeps quotes inside one", async () => {
    const f = await flow(`stateDiagram-v2
  [*] --> A : "URL provided"
  A : "Request built"
  A --> B : say #quot;hi#quot; now`);
    expect(f.nodes.find((n) => n.id === "A")!.label).toBe("Request built");
    expect(f.edges.map((e) => e.label)).toEqual([
      "URL provided",
      'say "hi" now',
    ]);
  });

  it("keeps a left-to-right state diagram left to right", async () => {
    const f = await flow("stateDiagram-v2\n  direction LR\n  a --> b");
    expect(f.direction).toBe("LR");
  });

  it("declines composite states, notes and forks", async () => {
    const declined = [
      "state Outer {\n    [*] --> In\n  }",
      "a --> b\n  note right of a : n",
      "state f <<fork>>\n  a --> f",
    ];
    for (const body of declined)
      expect(await ir(`stateDiagram-v2\n  ${body}`), body).toBeNull();
  });
});

describe("toIR for an entity model", () => {
  it("reads entities with their fields and relationships with both cardinalities", async () => {
    const out = await ir(`erDiagram
  THREAD ||--o{ MESSAGE : holds
  MESSAGE }|..|{ CITATION : cites
  THREAD ||--o| SHARE : "is shared as"
  THREAD {
    int id PK
    string title "the name"
  }
  MESSAGE["Message #lt;row#gt;"] {
    int ordinal
  }
  SHARE:::focus`);
    expect(out?.kind).toBe("er");
    const e = out as ERIR;
    expect(e.entities.map((x) => [x.id, x.label, x.focus ?? false])).toEqual([
      ["THREAD", "THREAD", false],
      ["MESSAGE", "Message <row>", false],
      ["CITATION", "CITATION", false],
      ["SHARE", "SHARE", true],
    ]);
    expect(e.entities[0].attrs).toEqual([
      { type: "int", name: "id", keys: ["PK"], comment: "" },
      { type: "string", name: "title", keys: [], comment: "the name" },
    ]);
    expect(e.rels).toEqual([
      {
        from: "THREAD",
        to: "MESSAGE",
        label: "holds",
        fromCard: "one",
        toCard: "zeroOrMore",
        dashed: false,
      },
      {
        from: "MESSAGE",
        to: "CITATION",
        label: "cites",
        fromCard: "oneOrMore",
        toCard: "oneOrMore",
        dashed: true,
      },
      {
        from: "THREAD",
        to: "SHARE",
        label: "is shared as",
        fromCard: "one",
        toCard: "zeroOrOne",
        dashed: false,
      },
    ]);
  });

  it("declines an entity related to itself", async () => {
    expect(await ir("erDiagram\n  A ||--o{ A : parent")).toBeNull();
  });

  it("declines tables grouped in a subgraph rather than drop what joins it", async () => {
    expect(
      await ir(`erDiagram
  subgraph Billing
    INVOICE ||--o{ LINE : has
  end
  CUSTOMER ||--o{ Billing : owns`),
    ).toBeNull();
  });

  it("fits up to eight entities", async () => {
    const src = (n: number) =>
      "erDiagram\n" +
      Array.from(
        { length: n - 1 },
        (_, i) => `  E${i} ||--o{ E${i + 1} : r`,
      ).join("\n");
    expect(fits((await ir(src(8)))!)).toBe(true);
    expect(fits((await ir(src(9)))!)).toBe(false);
  });
});

async function swimlane(src: string): Promise<SwimlaneIR> {
  const out = await ir(src);
  expect(out).not.toBeNull();
  expect(out!.kind).toBe("swimlane");
  return out as SwimlaneIR;
}

describe("toIR for a swimlane", () => {
  const lanes = `flowchart LR
  subgraph req["Requester"]
    a["Submit request"]
    e["Revise request"]
  end
  subgraph app["Approver"]
    b{"Complete?"}
    c["Approve"]:::focus
  end
  subgraph fin["Finance"]
    d["Pay out"]
  end
  a --> b
  b -->|"yes"| c
  b -->|"no"| e
  e --> b
  c -.-> d`;

  it("reads a left-to-right flow with every step in a subgraph as lanes", async () => {
    const s = await swimlane(lanes);
    expect(s.lanes).toEqual([
      { id: "req", title: "Requester" },
      { id: "app", title: "Approver" },
      { id: "fin", title: "Finance" },
    ]);
    expect(s.nodes.map((n) => [n.id, n.lane, n.shape])).toEqual([
      ["a", "req", "step"],
      ["e", "req", "step"],
      ["b", "app", "decision"],
      ["c", "app", "step"],
      ["d", "fin", "step"],
    ]);
    expect(s.nodes.find((n) => n.id === "c")!.focus).toBe(true);
    expect(s.nodes.some((n) => "zone" in n)).toBe(false);
    expect(s.edges.map((e) => [e.from, e.to, e.label, e.dashed])).toEqual([
      ["a", "b", "", false],
      ["b", "c", "yes", false],
      ["b", "e", "no", false],
      ["e", "b", "", false],
      ["c", "d", "", true],
    ]);
  });

  it("leaves a two-zone mapping a mapping: every arrow from the first zone into the second", async () => {
    const f = await flow(`flowchart LR
  subgraph ev["Event"]
    a["Order placed"]
    b["Order cancelled"]
  end
  subgraph hd["Handler"]
    x["Reserve stock"]
    y["Release stock"]
  end
  a --> x
  b --> y`);
    expect(f.kind).toBe("flow");
  });

  it("reads two zones as lanes once an arrow runs back or stays in a zone", async () => {
    const back = await swimlane(`flowchart LR
  subgraph ev["Requester"]
    a["Ask"]
  end
  subgraph hd["Helper"]
    x["Answer"]
  end
  a --> x
  x --> a`);
    expect(back.lanes).toHaveLength(2);
    const inside = await swimlane(`flowchart LR
  subgraph ev["Requester"]
    a["Ask"] --> b["Wait"]
  end
  subgraph hd["Helper"]
    x["Answer"]
  end
  b --> x`);
    expect(inside.nodes).toHaveLength(3);
  });

  it("keeps a flow a flow: top-down, one zone, a step outside every zone, an arrow to itself", async () => {
    const tb = await ir(`flowchart TD
  subgraph p["P"]
    a
  end
  subgraph q["Q"]
    b
  end
  a --> b
  b --> a`);
    expect(tb!.kind).toBe("flow");
    const one = await ir(`flowchart LR
  subgraph p["P"]
    a --> b
  end`);
    expect(one!.kind).toBe("flow");
    const outside = await ir(`flowchart LR
  subgraph p["P"]
    a
  end
  subgraph q["Q"]
    b
  end
  a --> b
  b --> c
  c --> a`);
    expect(outside!.kind).toBe("flow");
    const self = await ir(`flowchart LR
  subgraph p["P"]
    a
  end
  subgraph q["Q"]
    b
  end
  a --> b
  b --> b`);
    expect(self!.kind).toBe("flow");
  });

  it("puts a step in the lane that names it first, as the renderer does", async () => {
    // An arrow written inside one lane's body to a step of another claims
    // that step for the first lane: the renderer's db lists it there and
    // nowhere else, and its own drawing shows it there too.
    const s = await swimlane(`flowchart LR
  subgraph p["P"]
    a --> b
  end
  subgraph q["Q"]
    b
    c
  end
  b --> c
  c --> a`);
    expect(s.nodes.map((n) => [n.id, n.lane])).toEqual([
      ["a", "p"],
      ["b", "p"],
      ["c", "q"],
    ]);
  });

  it("folds two subgraphs of one title into one lane", async () => {
    // A role written twice, its last step in a subgraph of its own after
    // the others: one lane, where it was first written.
    const s = await swimlane(`flowchart LR
  subgraph s1["Sales"]
    a["Take order"]
  end
  subgraph w["Warehouse"]
    b["Pack parcel"]
  end
  subgraph s2["Sales"]
    c["Confirm shipment"]
  end
  a --> b --> c`);
    expect(s.lanes).toEqual([
      { id: "s1", title: "Sales" },
      { id: "w", title: "Warehouse" },
    ]);
    expect(s.nodes.map((n) => [n.id, n.lane])).toEqual([
      ["a", "s1"],
      ["b", "w"],
      ["c", "s1"],
    ]);
  });

  it("keeps a flow a flow when one title is all its subgraphs have", async () => {
    const f = await ir(`flowchart LR
  subgraph s1["Sales"]
    a
  end
  subgraph s2["Sales"]
    b
  end
  a --> b
  b --> a`);
    expect(f!.kind).toBe("flow");
  });
});

async function classes(src: string): Promise<ClassDiagramIR> {
  const out = await ir(src);
  expect(out).not.toBeNull();
  expect(out!.kind).toBe("class");
  return out as ClassDiagramIR;
}

describe("toIR for a class diagram", () => {
  it("reads classes with their stereotype, fields and methods", async () => {
    const c = await classes(`classDiagram
  class Shape {
    <<interface>>
    +area() double
    +name String
  }
  class Box["Storage box"]
  class Repo~T~ {
    +List~T~ items
    -int count$
    +find(id) T*
  }`);
    expect(c.direction).toBe("TB");
    expect(c.classes).toEqual([
      {
        id: "Shape",
        label: "Shape",
        stereotype: "interface",
        fields: [{ text: "+name String" }],
        methods: [{ text: "+area() : double" }],
      },
      { id: "Box", label: "Storage box", fields: [], methods: [] },
      {
        id: "Repo",
        label: "Repo<T>",
        fields: [
          { text: "+List<T> items" },
          { text: "-int count", static: true },
        ],
        methods: [{ text: "+find(id) : T", abstract: true }],
      },
    ]);
  });

  it("keeps angle brackets written as text, escaped on the way", async () => {
    const c = await classes(
      escapeAngles(`classDiagram
  class Cache {
    <<abstract>>
    +Map<K, V> entries
    +get(K key) Optional<V>
  }
  Cache --> Store : reads <K>`),
    );
    expect(c.classes[0].stereotype).toBe("abstract");
    expect(c.classes[0].fields).toEqual([{ text: "+Map<K, V> entries" }]);
    expect(c.classes[0].methods).toEqual([
      { text: "+get(K key) : Optional<V>" },
    ]);
    expect(c.rels[0].label).toBe("reads <K>");
  });

  it("reads each relationship with the mark at its to end", async () => {
    const c = await classes(`classDiagram
  direction LR
  Shape <|-- Square
  Shape <|.. Circle
  Order *-- Line
  Team o-- Person
  Order "1" --> "*" Invoice : bills
  Order ..> Clock
  Order -- Note
  Order .. Tag
  Part --* Machine
  Invoice --> "0..1" Payment`);
    expect(c.direction).toBe("LR");
    expect(
      c.rels.map((r) => [
        r.from,
        r.to,
        r.kind,
        r.dashed,
        r.label,
        r.fromCard,
        r.toCard,
      ]),
    ).toEqual([
      ["Square", "Shape", "inheritance", false, "", "", ""],
      ["Circle", "Shape", "inheritance", true, "", "", ""],
      ["Line", "Order", "composition", false, "", "", ""],
      ["Person", "Team", "aggregation", false, "", "", ""],
      ["Order", "Invoice", "association", false, "bills", "1", "*"],
      ["Order", "Clock", "association", true, "", "", ""],
      ["Order", "Note", "link", false, "", "", ""],
      ["Order", "Tag", "link", true, "", "", ""],
      ["Part", "Machine", "composition", false, "", "", ""],
      ["Invoice", "Payment", "association", false, "", "", "0..1"],
    ]);
  });

  it("marks a class tagged focus, inline or by cssClass", async () => {
    const c = await classes(`classDiagram
  class Order:::focus
  class Invoice
  class Line
  cssClass "Line" focus
  Order --> Invoice
  Order *-- Line`);
    expect(c.classes.filter((k) => k.focus).map((k) => k.id)).toEqual([
      "Order",
      "Line",
    ]);
  });

  it("reads classDiagram-v2 the same", async () => {
    const c = await classes("classDiagram-v2\n  A <|-- B");
    expect(c.classes.map((k) => k.id)).toEqual(["A", "B"]);
  });

  it("declines what it has no drawing for", async () => {
    for (const src of [
      // Notes, namespaces, a lollipop interface, a two-headed or
      // self relationship and the reversed directions.
      'classDiagram\n  class A\n  note for A "x"',
      "classDiagram\n  namespace Shop {\n    class A\n  }",
      "classDiagram\n  A ()-- B",
      "classDiagram\n  A <|--|> B",
      "classDiagram\n  A --> A",
      "classDiagram\n  direction RL\n  A --> B",
      "classDiagram\n  direction BT\n  A --> B",
    ])
      expect(await ir(src), src).toBeNull();
  });

  it("fits up to eight classes", async () => {
    const src = (n: number) =>
      "classDiagram\n" +
      Array.from({ length: n - 1 }, (_, i) => `  C${i} --> C${i + 1}`).join(
        "\n",
      );
    expect(fits((await ir(src(8)))!)).toBe(true);
    expect(fits((await ir(src(9)))!)).toBe(false);
  });
});

describe("toIR for what it does not draw", () => {
  it("is null for a kind it has no drawer for", async () => {
    expect(await ir(`pie\n  "a" : 1\n  "b" : 2`)).toBeNull();
  });

  it("is null for a db that is not the shape it reads", () => {
    expect(toIR("flowchart-v2", {})).toBeNull();
    expect(toIR("flowchart-v2", null)).toBeNull();
    expect(toIR("sequence", {})).toBeNull();
    expect(toIR("stateDiagram", {})).toBeNull();
    expect(toIR("er", {})).toBeNull();
    expect(toIR("classDiagram", {})).toBeNull();
  });
});

describe("fits", () => {
  it("draws up to sixteen nodes and hands larger ones on", async () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `  n${i} --> n${i + 1}`).join("\n");
    expect(fits(await flow(`flowchart TD\n${lines(15)}`))).toBe(true);
    expect(fits(await flow(`flowchart TD\n${lines(16)}`))).toBe(false);
  });
});
