import { beforeAll, describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { forRenderer, styleSemicolons, unsafeSource, unsafeSvg } from "./guard";
import { escapeAngles, repair } from "./text";
import { editorial } from "./editorial";
import { mermaidConfig } from "./draw";

// A fence is model output, and the model may have read a page written to
// steer it. The renderer reaches the network for a handful of constructs
// (an image in node data, a themeCSS, a url() in a style, a C4 sprite) and
// its grammars are wide (any case, `;` between statements, indented front
// matter): a source naming any of them is not drawn by it at all.
const evil = "https://evil.example";

const vectors: [string, string][] = [
  ["node image", `flowchart TD\n  A@{ img: "${evil}/a.png" } --> B`],
  ["node data", `flowchart TD\n  A@{ shape: diamond } --> B`],
  ["style url", `flowchart TD\n  A --> B\n  style A fill:url(${evil}/s)`],
  ["statements after ;", `flowchart TD; A --> B; style A fill:url(x.png)`],
  ["any case", `flowchart TD\n  A --> B\n  CLASSDEF x fill:URL(x.png)`],
  ["css escape", `flowchart TD\n  A --> B\n  classDef x fill:\\75rl(x)`],
  ["image-set", `flowchart TD\n  A --> B\n  classDef x fill:image-set(a 1x)`],
  ["@import", `flowchart TD\n  A --> B\n  classDef x font:@import x`],
  ["click", `flowchart TD\n  A --> B\n  click A href "${evil}"`],
  ["click, any case", `flowchart TD\n  A --> B\n  CLICK A call go()`],
  [
    "sequence link",
    `sequenceDiagram\n  participant A\n  LINK A: Docs @ ${evil}\n  A->>A: hi`,
  ],
  [
    "sequence links",
    `sequenceDiagram\n  participant A\n  links A: {"x": "y"}\n  A->>A: hi`,
  ],
  [
    "C4 style",
    `C4Context\n  Person(a, "A")\n  UpdateElementStyle(a, $bgColor="red")`,
  ],
  ["C4 link", `C4Context\n  Person(a, "A", $link="x")`],
  ["C4 sprite", `C4Context\n  Person(a, "A", $sprite="x")`],
  ["C4 tags", `C4Context\n  Person(a, "A", $tags="x")`],
  ["html image", `flowchart TD\n  A["<img src=x>"] --> B`],
  ["html anchor", `flowchart TD\n  A["<a href=x>y</a>"] --> B`],
  ["javascript", `flowchart TD\n  A["javascript:go()"] --> B`],
  ["data url", `flowchart TD\n  A["data:image/svg+xml,x"] --> B`],
  ["protocol-relative", `flowchart TD\n  A["//evil.example/x"] --> B`],
  ["http", `pie\n  "${evil}" : 1`],
  ["url()", `flowchart TD\n  A --> B\n  classDef x fill:url(x.png)`],
  ["HTML named code for a backslash", `flowchart TD\n  A["&bsol;x"] --> B`],
  ["mermaid code for a tag", `flowchart TD\n  A["#60;img src=x#62;"] --> B`],
  ["HTML hex code for a URL", `flowchart TD\n  A["https&#x3a;//x"] --> B`],
  ["a code spelling a code", `flowchart TD\n  A["&amp;#92;x"] --> B`],
  ["poster attribute", `flowchart TD\n  A["x poster=y"] --> B`],
  ["srcset attribute", `flowchart TD\n  A["x srcset = y"] --> B`],
  ["html video", `flowchart TD\n  A["<video poster=x>"] --> B`],
  ["html picture", `flowchart TD\n  A["<picture><source srcset=x>"] --> B`],
  ["background attribute", `flowchart TD\n  A["<table background=x>"] --> B`],
  ["cross-fade", `flowchart TD\n  A --> B\n  classDef x fill:cross-fade(a, b)`],
  // Markup, raw or as escapeAngles writes it: judged decoded, as drawn.
  ["raw script", `flowchart TD\n  A["<script>go()</script>"] --> B`],
  [
    "raw script, any case, with an attribute",
    `flowchart TD\n  A["<SCRIPT async x=1>go()</SCRIPT>"] --> B`,
  ],
  ["raw style", `flowchart TD\n  A["<style >x</style>"] --> B`],
  // Any tag with any attribute: a valueless one first, a quoted `>`, a
  // line break, a handler however far in, a name inside a name.
  [
    "object, a valueless attribute first",
    `flowchart TD\n  A["<object hidden data=/api/logout>"] --> B`,
  ],
  [
    "link preload",
    `flowchart TD\n  A["x<link x rel=preload imagesrcset=/x>"] --> B`,
  ],
  [
    "a quoted > before a handler",
    `flowchart TD\n  A["<div title='>' onclick=go()>"] --> B`,
  ],
  ["a line break in a tag", `flowchart TD\n  A["<div\nonclick=go()>"] --> B`],
  [
    "a handler far in",
    `flowchart TD\n  A["<div ${"x ".repeat(400)}onclick=go()>"] --> B`,
  ],
  ["any tag, any attribute", `flowchart TD\n  A["<p data-x=1>"] --> B`],
  ["a one-letter tag after a space", `flowchart TD\n  A["a <b x=1> c"] --> B`],
  ["an acting tag after a word", `flowchart TD\n  A["List<iframe>"] --> B`],
  ["image with an attribute", `flowchart TD\n  A["<image width=1>"] --> B`],
  ["svg onload after a slash", `flowchart TD\n  A["<svg/onload=go()>"] --> B`],
  [
    "img onerror after a slash",
    `flowchart TD\n  A["<img/onerror=go()>"] --> B`,
  ],
  ["object data after a slash", `flowchart TD\n  A["<OBJECT/data=x>"] --> B`],
  [
    "an event handler",
    `flowchart TD\n  A["<div onmouseover=go()>x</div>"] --> B`,
  ],
  // Whatever precedes them: a word char made the tags generics once.
  [
    "script after a word",
    `flowchart TD\n  A["List<script>go()</script>"] --> B`,
  ],
  ["iframe after a word", `flowchart TD\n  A["x<iframe .a=1 srcdoc=y>"] --> B`],
  ["object after a word", `flowchart TD\n  A["x<object .a=1 data=y>"] --> B`],
  ["embed after a word", `flowchart TD\n  A["x<embed .a=1 type=y>"] --> B`],
  ["style after a word", `flowchart TD\n  A["x<style>"] --> B`],
  ["html base", `flowchart TD\n  A["<base>"] --> B`],
  ["meta", `flowchart TD\n  A["x<meta>"] --> B`],
  ["form", `flowchart TD\n  A["x<form>"] --> B`],
  ["noscript", `flowchart TD\n  A["x<noscript>"] --> B`],
  ["template", `flowchart TD\n  A["x<template>"] --> B`],
  // An attribute named broadly: `.a=`, `:x=`.
  ["svg with an odd attribute", `flowchart TD\n  A["x<svg .a=1>"] --> B`],
  ["link with an odd attribute", `flowchart TD\n  A["x<link :x=1>"] --> B`],
  ["anchor after a word", `flowchart TD\n  A["x<a b=1>y</a>"] --> B`],
  ["img after a word", `flowchart TD\n  A["List<IMG/x=1>"] --> B`],
  // A code that spells a refused construct once decoded.
  ["url() by a code in a label", `flowchart TD\n  A["#117;rl(x.png)"] --> B`],
  [
    "url() by a code in a style",
    `flowchart TD\n  A --> B\n  style A fill:#117;rl(x.png);`,
  ],
  [
    "backslash by a code in a classDef",
    `flowchart TD\n  A --> B\n  classDef x fill:#000092;75rl(x.png);`,
  ],
  [
    "url() by a code in a linkStyle",
    `flowchart TD\n  A --> B\n  linkStyle 0 stroke:#000117;rl(x.png)`,
  ],
  // `&x;` is no code mermaid consumes: the `;` ends a statement.
  ["click after &x;", `flowchart TD\n  A --> B &x; click B "rel.html"`],
  [
    "codes nested past reading",
    'flowchart TD\n  A["&amp;amp;amp;amp;amp;x"] --> B',
  ],
  // A sequence message ends at a `;`, quoted or not.
  [
    "sequence link in quotes",
    `sequenceDiagram\n  participant A\n  A->>A: "x; link A: Docs @ rel.html"`,
  ],
  // mermaid's own placeholders for `&#`, `&` and `;`, written out.
  [
    "url() by mermaid's placeholders",
    "flowchart TD\n  A --> B\n  classDef x fill:ﬂ°°117¶ßrl(x.png)",
  ],
  [
    "backslash by mermaid's placeholders",
    'flowchart TD\n  A["ﬂ°bsol¶ßx"] --> B',
  ],
];

// Refused before, drawn now: what the renderer's lock makes inert (a
// directive's or front matter's config, stripped as mermaid would discard
// it anyway) and markup without an attribute, drawn as text with HTML
// labels off. The oracle below shows none of them fetches.
const harmless: [string, string][] = [
  [
    "directive",
    `%%{init: {"themeCSS": ".n{fill:url(${evil}/t)}"}}%%\nflowchart TD\n  A --> B`,
  ],
  ["directive, any case", `%%{ INITIALIZE: {} }%%\nflowchart TD\n  A --> B`],
  // A code is judged by what it decodes to: alone, these build nothing.
  ["mermaid character code", `flowchart TD\n  A["#60;img#62;"] --> B`],
  ["mermaid code for a colon", `flowchart TD\n  A["x#58;y"] --> B`],
  ["mermaid named code", `flowchart TD\n  A["x#colon;y#sol;#lpar;"] --> B`],
  ["HTML character code", `flowchart TD\n  A["&#58;x"] --> B`],
  ["HTML hex character code", `flowchart TD\n  A["&#x3a;x"] --> B`],
  ["colour-shaped code in a label", `flowchart TD\n  A["x#000058;y"] --> B`],
  ["a dark theme", `%%{init: {'theme':'dark'}}%%\nflowchart TD\n  A --> B`],
  [
    "front matter config",
    `---\nconfig:\n  themeCSS: ".n{background:url(${evil}/f)}"\n---\nflowchart TD\n  A --> B`,
  ],
  [
    "front matter closed early for us, not for mermaid",
    `---\ntitle: x\n  ---\nconfig:\n  look: neo\n---\nflowchart TD\n  A --> B`,
  ],
  [
    "front matter on bare \\r",
    `---\rconfig:\r  themeCSS: ".n{fill:red}"\r---\rflowchart TD\r  A --> B`,
  ],
  ["svg use", `flowchart TD\n  A["<svg><use/></svg>"] --> B`],
  // A bare tag in capitals has no attribute: with HTML labels locked off
  // it is text, as the oracle shows. A type named like one is a type.
  ["a bare tag in capitals", `flowchart TD\n  A["<SCRIPT>"] --> B`],
  ["a frame type", `flowchart TD\n  A["x<FRAME>"] --> B`],
];

/** As draw hands a source to the renderer. */
const asDrawn = (src: string) => forRenderer(escapeAngles(repair(src)));

describe("unsafeSource", () => {
  for (const [name, src] of vectors)
    it(`refuses ${name}`, () => {
      expect(unsafeSource(src)).not.toBeNull();
      // As draw hands it over, still refused.
      expect(unsafeSource(asDrawn(src))).not.toBeNull();
    });

  for (const [name, src] of harmless)
    it(`draws ${name}, its config stripped or its markup text`, () => {
      expect(unsafeSource(asDrawn(src))).toBeNull();
    });

  // Without a document a named code cannot be read: refused. Numeric ones
  // and the few mermaid's own escaping writes are read all the same.
  it("decodes without a document, refusing a name it cannot read", () => {
    vi.stubGlobal("document", undefined);
    try {
      expect(
        unsafeSource('flowchart TD\n  A["x&colon;y"] --> B'),
      ).not.toBeNull();
      expect(
        unsafeSource('flowchart TD\n  A["#117;rl(x)"] --> B'),
      ).not.toBeNull();
      expect(
        unsafeSource('flowchart TD\n  A["List#lt;T#gt;"] --> B'),
      ).toBeNull();
      expect(
        unsafeSource("flowchart TD\n  A --> B\n  classDef focus fill:#ffe9a8;"),
      ).toBeNull();
      // The legacy names in capitals read as the browser reads them, with a
      // `;` as without one.
      expect(unsafeSource('flowchart TD\n  A["x &LT; y"] --> B')).toBeNull();
      expect(unsafeSource('flowchart TD\n  A["x &LT y"] --> B')).toBeNull();
      expect(unsafeSource('flowchart TD\n  A["x &AMP; y"] --> B')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Code in class and sequence diagrams: names a word char precedes, and
  // generics, raw or escaped.
  it("lets identifiers and generics through", () => {
    for (const label of [
      "ParseURL(x)",
      "imageUrl(id)",
      "URL()",
      "resolveUrl (path)",
      "Map<String, Object>",
      "List<Link>",
      "Optional<Source>",
      "Optional<Object>",
      "List<Source>",
      "Pair<A, B>",
      "Set<Image>",
      "Map<Link, Svg>",
      "List<Template>",
      "Optional<Form>",
      "Page<Frame>",
      "Map<K, Style>",
      "<<Template>>",
      "<<interface>>",
    ]) {
      const src = `classDiagram\n  class Repo {\n    +${label}\n  }`;
      expect(unsafeSource(src), label).toBeNull();
      expect(unsafeSource(asDrawn(src)), label).toBeNull();
    }
  });

  // A long line with a `<` and no `>`, or many `style` words, took seconds
  // in a backtracking rule. Warmed up once, then well under that.
  it("judges a long line in linear time", () => {
    for (const line of [
      `flowchart TD\n  A[<${"a".repeat(100_000)}`,
      `flowchart TD\n  A[<x ${" on".repeat(30_000)}`,
      `flowchart TD\n  A[${"<a ".repeat(30_000)}`,
      `flowchart TD\n  A[<x on${"a".repeat(100_000)}`,
      `flowchart TD\n  A[<a${" x".repeat(50_000)}`,
      `flowchart TD\n  A[<${" ".repeat(100_000)}`,
      `flowchart TD\n  A[${"#lt;a ".repeat(20_000)}`,
      `flowchart TD\n  A[${"<a b".repeat(25_000)}`,
      `flowchart TD\n  ${"style ".repeat(20_000)}`,
      `flowchart TD\n  ${"classDef :".repeat(10_000)}`,
      `flowchart TD\n  style ${":".repeat(50_000)}`,
    ]) {
      unsafeSource(line);
      const t = performance.now();
      unsafeSource(line);
      expect(performance.now() - t, line.slice(0, 30)).toBeLessThan(200);
    }
  });

  // mermaid's own reading of a style line's last `;`, its regexes run
  // where they are fast, against ours on every line shape.
  it("reads a style line's last semicolon as mermaid does", () => {
    const theirs = (t: string) =>
      t
        .replace(/style.*:\S*#.*;/g, (s) => s.slice(0, -1))
        .replace(/classDef.*:\S*#.*;/g, (s) => s.slice(0, -1));
    const lines = [
      "style A fill:#ffe9a8;",
      "style A fill:#123,stroke:#456;",
      "style A fill:#000058;stroke:#fff;",
      "classDef a fill:#111111;stroke:#222222;",
      "classDef x fill:#117;rl(x.png);",
      "classDef x fill: #117;",
      "classDef x fill:a #117;",
      "classDef x fill:a:#117",
      "linkStyle 0 stroke:#000058;",
      "Style A fill:#fff;",
      "x style y : z#1; w; v",
      "A --> B; style A fill:#f00; style B fill:#0f0;",
      "style classDef a:#1;b:#2;",
      "classDef style a:#1;",
      '  A["styled: #x; y"] --> B;',
      "style A fill:#fff\u2028x;",
      "style A:\u00a0#1;",
      ";style:#;",
    ];
    for (const line of lines)
      expect(styleSemicolons(line), line).toBe(theirs(line));
    expect(styleSemicolons(lines.join("\n"))).toBe(theirs(lines.join("\n")));
    // On every corpus source.
    const corpus: Record<string, string> = import.meta.glob(
      "../../testdata/diagrams/*.mmd",
      { query: "?raw", import: "default", eager: true },
    );
    for (const [file, src] of Object.entries(corpus))
      expect(styleSemicolons(src), file).toBe(theirs(src));
    // And on random lines of the characters that matter.
    const alphabet = [
      "style",
      "classDef",
      ":",
      "#",
      ";",
      " ",
      "a",
      "\n",
      String.fromCharCode(0x2028),
    ];
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647);
    for (let n = 0; n < 5000; n++) {
      let s = "";
      for (let k = next() % 14; k > 0; k--)
        s += alphabet[next() % alphabet.length];
      expect(styleSemicolons(s), JSON.stringify(s)).toBe(theirs(s));
    }
  });

  it("lets plain sources through, arrows and stereotypes included", () => {
    for (const src of [
      // The words, not the attributes.
      'flowchart TD\n  A["Posters and social media"] --> B["A poster"]',
      'flowchart TD\n  A["The srcset idea"] --> B["Background work"]',
      // A colour before a `;` is a colour: mermaid itself reads it so.
      "flowchart TD\n  A --> B\n  classDef focus fill:#ffe9a8;",
      "flowchart TD\n  A --> B\n  style A fill:#123,stroke:#456;",
      "flowchart TD\n  A --> B\n  classDef a fill:#111111;stroke:#222222;",
      // All digits: a colour where mermaid strips the `;`, a colon where
      // it reads a code, and a colon alone builds nothing refused.
      "flowchart TD\n  A --> B\n  classDef a fill:#000058;",
      "flowchart TD\n  A --> B\n  style A fill:#000058;stroke:#fff;",
      "flowchart TD\n  A --> B\n  linkStyle 0 stroke:#000058;",
      "flowchart TD\n  A --> B\n  linkStyle 0 stroke:#ffe9a8;",
      // mermaid writes `#x3a;` as `&x3a;`, which names nothing.
      'flowchart TD\n  A["x#x3a;y"] --> B',
      // The codes escapeAngles writes, and a quote.
      'flowchart TD\n  A["List#lt;T#gt; #quot;x#quot;"] --> B',
      "classDiagram\n  class Shape {\n    <<interface>>\n  }\n  Shape <|-- Circle\n  A <-- B",
      "sequenceDiagram\n  A->>B: hi\n  B-->>A: <b>back</b>",
      "---\ntitle: Orders\n---\nflowchart TD\n  A --> B",
      'pie\n  title Share\n  "Data" : 2\n  "Metadata: tags" : 1',
      "gantt\n  dateFormat YYYY-MM-DD\n  a : 2024-01-01, 1d",
      "flowchart TD\n  A --> B\n  classDef focus stroke-width:2px\n  style B fill:#f00",
      // CRLF is a line break, not front matter beyond a title.
      "---\r\ntitle: Orders\r\n---\r\nflowchart TD\r\n  A --> B",
      // Prose with a bracket and a tag-like word apart from it.
      'flowchart TD\n  A["x < a second"] --> B',
      // A `<` then a space is never a tag, an `=` after it prose.
      'flowchart TD\n  A["a < b and c = d"] --> B',
      'flowchart TD\n  A["x < 5 = y"] --> B',
      'flowchart TD\n  A["if a < script then x = 1"] --> B',
      // click and link are words outside the kinds that have them.
      "journey\n  section Browse\n    Click checkout: 5: User",
      'pie\n  "Data: raw" : 3',
      // Quoted text is a label, its `;` no statement's end.
      'flowchart TD\n  A["R&amp;D; click here"] --> B',
      'flowchart TD\n  A["List&lt;Link&gt;"] --> B',
    ])
      expect(unsafeSource(src), src).toBeNull();
  });
});

describe("unsafeSvg", () => {
  it("refuses a drawing that loads from outside, and keeps local references", () => {
    const svg = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    for (const bad of [
      `<image href="${evil}/x.png"/>`,
      `<image xlink:href="x.png"/>`,
      `<use href="other.svg#a"/>`,
      `<a href="${evil}"><text>x</text></a>`,
      `<foreignObject><img src="x.png"/></foreignObject>`,
      `<rect style="fill:url(${evil}/x)"/>`,
      `<rect fill="url('x.svg#p')"/>`,
      `<style>.a{fill:url(x.png)}</style>`,
      `<style>@import "x.css";</style>`,
      `<style>.a{fill:image-set("x.png" 1x)}</style>`,
      `<style>.a{fill:\\75rl(x)}</style>`,
      `<rect style="fill:cross-fade(a, b)"/>`,
      `<img srcset="x.png 2x"/>`,
      `<video poster="x.png"/>`,
      `<table background="x.png"></table>`,
      `<rect data-x="javascript:go()"/>`,
      `<rect data-x="//evil.example"/>`,
      `<image href="data:text/html,x"/>`,
      `<rect onmouseover="go()"/>`,
    ])
      expect(unsafeSvg(svg(bad)), bad).not.toBeNull();
    for (const ok of [
      `<use href="#a"/>`,
      `<rect fill="url(#grad)"/>`,
      `<style>.a{filter:url( "#shadow")}</style>`,
      `<text>url(${evil}) is just text</text>`,
      `<rect style="fill:#fff;stroke:#000"/>`,
      // C4's person icon: a picture inline, not a request.
      `<image href="data:image/png;base64,iVBOR"/>`,
    ])
      expect(unsafeSvg(svg(ok)), ok).toBeNull();
  });
});

// A source cannot set what is locked: a directive or front matter that
// tried left the drawing as the package configured it. Rendered without
// the gate, to see the renderer's own lock hold.
describe("the renderer's locked config", () => {
  beforeAll(() => {
    const proto = SVGElement.prototype as unknown as Record<string, unknown>;
    proto.getBBox = () => ({ x: 0, y: 0, width: 50, height: 20 });
    proto.getComputedTextLength = () => 50;
    mermaid.initialize(mermaidConfig({}, mermaid.mermaidAPI.defaultConfig));
  });

  const label = "A : <span style='color:red'>x</span>\n  [*] --> A";
  for (const [how, src] of [
    [
      "directive",
      `%%{init: {"htmlLabels": true, "themeCSS": ".marker-x{fill:red}", "flowchart": {"htmlLabels": true}}}%%\nstateDiagram-v2\n  ${label}`,
    ],
    [
      "front matter",
      `---\nconfig:\n  htmlLabels: true\n  themeCSS: ".marker-x{fill:red}"\n---\nstateDiagram-v2\n  ${label}`,
    ],
  ])
    it(`ignores htmlLabels and themeCSS set by ${how}`, async () => {
      const { svg } = await mermaid.render(`lock-${how.length}`, src);
      expect(svg).not.toContain(".marker-x");
      expect(svg).not.toMatch(/<span[^>]*style=/);
    });

  it("locks every key that holds CSS, a font, a colour or a URL", () => {
    const secure = new Set(
      (
        mermaidConfig({}, mermaid.mermaidAPI.defaultConfig) as {
          secure: string[];
        }
      ).secure,
    );
    for (const key of [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "dompurifyConfig",
      "htmlLabels",
      "themeCSS",
      "themeVariables",
      "fontFamily",
      "altFontFamily",
      // Read off the renderer's defaults: a section's own.
      "actorFontFamily",
      "personFontFamily",
      "ticketBaseUrl",
      "linkColor",
    ])
      expect(secure, key).toContain(key);
  });
});

describe("the renderer", () => {
  beforeAll(() => {
    // jsdom measures nothing; the renderer needs a size to lay out.
    const proto = SVGElement.prototype as unknown as Record<string, unknown>;
    proto.getBBox = () => ({ x: 0, y: 0, width: 50, height: 20 });
    proto.getComputedTextLength = () => 50;
    mermaid.initialize(mermaidConfig({}, mermaid.mermaidAPI.defaultConfig));
  });

  /** fetches is the oracle: would a browser load an outside URL for this
   * drawing? A stylesheet's or an attribute's url(), a src or an href to
   * a host. Text that merely spells one out is text. */
  const remote = /url\(\s*["']?(?:https?:)?\/\//i;
  const fetches = (svg: string): boolean => {
    const doc = new DOMParser().parseFromString(svg, "text/html");
    for (const s of doc.querySelectorAll("style"))
      if (remote.test(s.textContent ?? "")) return true;
    for (const el of doc.querySelectorAll("*"))
      for (const a of el.attributes) {
        if (a.name.startsWith("xmlns")) continue;
        if (remote.test(a.value)) return true;
        if (
          /^(src|href|xlink:href)$/.test(a.name) &&
          /^(https?:)?\/\//i.test(a.value)
        )
          return true;
      }
    return false;
  };

  // Every vector the renderer draws as written: whatever it would fetch,
  // the check of its drawing (the second line of defence) refuses too.
  it("agrees with the oracle on every vector's drawing", async () => {
    let seen = 0;
    for (const [i, [name, src]] of vectors.entries()) {
      let svg: string;
      try {
        svg = (await mermaid.render(`v${i}`, src)).svg;
      } catch {
        continue;
      }
      if (fetches(svg)) {
        seen++;
        expect(unsafeSvg(svg), name).not.toBeNull();
      }
    }
    // The style vectors at least fetch, as written.
    expect(seen).toBeGreaterThan(0);
  });

  // What the gate now lets through draws without a fetch, as draw hands it
  // over: config stripped, markup as text.
  it("fetches nothing for what it now draws", async () => {
    let drawn = 0;
    const all = [...harmless, ...vectors];
    for (const [i, [name, src]] of all.entries()) {
      const text = asDrawn(src);
      if (unsafeSource(text) !== null) continue;
      const { svg } = await mermaid.render(`h${i}`, text);
      drawn++;
      expect(fetches(svg), name).toBe(false);
      expect(unsafeSvg(svg), name).toBeNull();
    }
    expect(drawn).toBe(harmless.length);
  });

  // With HTML labels off a formatting tag is drawn as its text: forRenderer
  // takes it out, and keeps a line break where the kind draws one.
  it("draws formatting as plain text and a break as a break", async () => {
    for (const [i, src] of [
      'flowchart TD\n  A["<b>bold</b> and <code>x</code><br>next"] --> B',
      "sequenceDiagram\n  A->>B: <i>it</i><br/>next",
      "stateDiagram-v2\n  A : <strong>s</strong><br>next\n  [*] --> A",
      "classDiagram\n  A <|-- B : <em>e</em><br>next",
    ].entries()) {
      const { svg } = await mermaid.render(`f${i}`, asDrawn(src));
      expect(svg, src).not.toMatch(/&lt;\/?(b|i|em|strong|code|br)/);
      expect(svg, src).toMatch(/>next</);
    }
  });
});

describe("forRenderer", () => {
  // Every line stays where it was, emptied: a parse error names the line
  // the reader sees in the fence.
  it("strips a directive, as the renderer reads it, line for line", () => {
    expect(
      forRenderer("%%{init: {'theme':'dark'}}%%\nflowchart TD\n  A --> B"),
    ).toBe("\nflowchart TD\n  A --> B");
    expect(
      forRenderer(
        "%%{init: {\n  'theme':'dark'\n}}%%\nflowchart TD\n  A --> B",
      ),
    ).toBe("\n\n\nflowchart TD\n  A --> B");
    expect(forRenderer('flowchart TD\n  A --> B\n%%{init: {"x": 1\n2')).toBe(
      "flowchart TD\n  A --> B\n\n",
    );
  });

  it("keeps a front matter's title alone, line for line", () => {
    expect(
      forRenderer(
        "---\ntitle: Orders\nconfig:\n  look: neo\n---\nflowchart TD\n  A --> B",
      ),
    ).toBe("---\ntitle: Orders\n\n\n---\nflowchart TD\n  A --> B");
    expect(
      forRenderer("---\nconfig:\n  look: neo\n---\nflowchart TD\n  A --> B"),
    ).toBe("\n\n\n\nflowchart TD\n  A --> B");
  });

  it("leaves a parse error on the line it is in the fence", async () => {
    const src =
      "---\nconfig:\n  look: neo\n---\n%%{init: {\n 'theme':'dark' }}%%\nflowchart TD\n  A --> B\n  B -->";
    const line = async (s: string) => {
      try {
        await mermaid.parse(s);
      } catch (e) {
        return /line (\d+)/.exec(String(e))?.[1];
      }
      return undefined;
    };
    const original = await line(src);
    expect(original).toBeDefined();
    expect(await line(forRenderer(src))).toBe(original);
  });

  it("takes out formatting tags, and a break the kind cannot draw", () => {
    expect(
      forRenderer('flowchart TD\n  A["<b>x</b> <span>y</span><br>z"]'),
    ).toBe('flowchart TD\n  A["x y<br>z"]');
    expect(forRenderer('pie\n  "a<br>b" : 1')).toBe('pie\n  "a b" : 1');
    expect(forRenderer("timeline\n  2024 : a<br/>b")).toBe(
      "timeline\n  2024 : a<br>b",
    );
    // A span with attributes stays: drawn as its text, never markup.
    const styled = "flowchart TD\n  A[\"<span style='x'>y</span>\"]";
    expect(forRenderer(styled)).toBe(styled);
  });

  it("leaves a source with none of these byte for byte", () => {
    const src = "classDiagram\n  A <|-- B : List<Link>";
    expect(forRenderer(src)).toBe(src);
  });
});

describe("the corpus", () => {
  const sources: Record<string, string> = import.meta.glob(
    "../../testdata/diagrams/*.mmd",
    { query: "?raw", import: "default", eager: true },
  );

  beforeAll(() => {
    const proto = SVGElement.prototype as unknown as Record<string, unknown>;
    proto.getBBox = () => ({ x: 0, y: 0, width: 50, height: 20 });
    proto.getComputedTextLength = () => 50;
    mermaid.initialize(mermaidConfig({}, mermaid.mermaidAPI.defaultConfig));
  });

  // What the renderer drew before (the package declined it) it still
  // draws: the gate refuses none of the corpus, and none of its drawings.
  // A kind jsdom cannot render (a mind map wants a canvas) is checked at
  // the gate only.
  it("keeps every source the renderer draws drawable", async () => {
    const refused: string[] = [];
    let renderer = 0;
    const rendered: string[] = [];
    for (const [path, raw] of Object.entries(sources)) {
      const text = escapeAngles(repair(raw.trimEnd()));
      if (!(await mermaid.parse(text, { suppressErrors: true }))) continue;
      if ((await editorial(mermaid, text, "c")) !== null) continue;
      renderer++;
      const given = forRenderer(text);
      const why = unsafeSource(given);
      if (why !== null) {
        refused.push(`${path}: ${why}`);
        continue;
      }
      let svg: string;
      try {
        svg = (await mermaid.render(`c${renderer}`, given)).svg;
      } catch {
        continue;
      }
      rendered.push(path);
      const bad = unsafeSvg(svg);
      if (bad !== null) refused.push(`${path} drawn: ${bad}`);
    }
    expect(renderer).toBeGreaterThan(5);
    expect(refused).toEqual([]);
    // A C4 person (its icon inline), a journey step named Click, a pie
    // slice named Data, code with url-named methods and generics, a dark
    // theme directive with formatting: drawn, not refused.
    for (const name of [
      "c4-context",
      "journey-click",
      "pie-data-label",
      "class-code-past-caps",
      "pie-dark-directive",
    ])
      expect(rendered).toContain(`../../testdata/diagrams/${name}.mmd`);
    // It lays out and renders the whole corpus: seconds on a CI runner.
  }, 60_000);
});
