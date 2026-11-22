import { beforeAll, describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { unsafeSource, unsafeSvg } from "./guard";
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
  [
    "directive",
    `%%{init: {"themeCSS": ".n{fill:url(${evil}/t)}"}}%%\nflowchart TD\n  A --> B`,
  ],
  ["directive, any case", `%%{ INITIALIZE: {} }%%\nflowchart TD\n  A --> B`],
  [
    "front matter config",
    `---\nconfig:\n  themeCSS: ".n{background:url(${evil}/f)}"\n---\nflowchart TD\n  A --> B`,
  ],
  [
    "front matter closed early for us, not for mermaid",
    `---\ntitle: x\n  ---\nconfig:\n  look: neo\n---\nflowchart TD\n  A --> B`,
  ],
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
  ["svg use", `flowchart TD\n  A["<svg><use/></svg>"] --> B`],
  ["javascript", `flowchart TD\n  A["javascript:go()"] --> B`],
  ["data url", `flowchart TD\n  A["data:image/svg+xml,x"] --> B`],
  ["protocol-relative", `flowchart TD\n  A["//evil.example/x"] --> B`],
  ["http", `pie\n  "${evil}" : 1`],
  [
    "front matter on bare \\r",
    `---\rconfig:\r  themeCSS: ".n{fill:red}"\r---\rflowchart TD\r  A --> B`,
  ],
  ["mermaid character code", `flowchart TD\n  A["#60;img#62;"] --> B`],
  ["hex character code", `flowchart TD\n  A["x#x3a;y"] --> B`],
  ["HTML character code", `flowchart TD\n  A["&#58;x"] --> B`],
  ["html video", `flowchart TD\n  A["<video poster=x>"] --> B`],
  ["html picture", `flowchart TD\n  A["<picture><source srcset=x>"] --> B`],
  ["html base", `flowchart TD\n  A["<base>"] --> B`],
  ["background attribute", `flowchart TD\n  A["<table background=x>"] --> B`],
  ["cross-fade", `flowchart TD\n  A --> B\n  classDef x fill:cross-fade(a, b)`],
];

describe("unsafeSource", () => {
  for (const [name, src] of vectors)
    it(`refuses ${name}`, () => {
      expect(unsafeSource(src)).not.toBeNull();
      // Escaped as draw escapes it, still refused.
      expect(unsafeSource(escapeAngles(repair(src)))).not.toBeNull();
    });

  it("lets plain sources through, arrows and stereotypes included", () => {
    for (const src of [
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
      // click and link are words outside the kinds that have them.
      "journey\n  section Browse\n    Click checkout: 5: User",
      'pie\n  "Data: raw" : 3',
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
    // The theme vectors at least fetch, as written.
    expect(seen).toBeGreaterThan(0);
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
      const why = unsafeSource(text);
      if (why !== null) {
        refused.push(`${path}: ${why}`);
        continue;
      }
      let svg: string;
      try {
        svg = (await mermaid.render(`c${renderer}`, text)).svg;
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
    // slice named Data: drawn, not refused.
    for (const name of ["c4-context", "journey-click", "pie-data-label"])
      expect(rendered).toContain(`../../testdata/diagrams/${name}.mmd`);
    // It lays out and renders the whole corpus: seconds on a CI runner.
  }, 60_000);
});
