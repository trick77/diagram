# diagram

Turns a few lines of text into calm, readable diagrams, laid out and drawn right in the browser.

A diagram source goes in, either mermaid text or the diagram's structure as JSON, and a finished SVG drawing comes
out. The layout follows a small set of hand-tuned rules: the main path runs straight down, branches leave it to the
side, one accent marks only what the question is about, every connector is straight or bent at right angles (a
mind map's curves are the one exception), and every label is measured before it is placed, so no box ever clips its
text. Each drawing comes with a full view and an SVG download.

## What it draws

- Flowcharts (`flowchart`, `graph`): a main path with branches, two-column mappings, grouped zones
- Org charts (`flowchart TD` that is a tree): the root on top, children on a shared bus
- Swimlanes (`flowchart LR`, one `subgraph` per role): a process across roles, one lane each
- Mind maps (`mindmap`): the topic in the middle, branches around it, leaves beside them
- Sequence diagrams (`sequenceDiagram`): notes and nested frames (`alt`, `loop`, `par`, ...)
- State diagrams (`stateDiagram-v2`, `stateDiagram`)
- Entity-relationship diagrams (`erDiagram`): fields and cardinalities
- Class diagrams (`classDiagram`): fields, methods, inheritance, composition and association
- Timelines (`timeline`): lying flat where the text has room for them, standing up where it has not
- Quadrant charts (`quadrantChart`): every point labelled beside its dot, the focus in the accent

Any other mermaid kind, or a diagram too large to compose well, is handed to the mermaid renderer and drawn in the
same card.

## Install

```json
"dependencies": {
  "@trick77/diagram": "^0.1.0"
}
```

The package ships its TypeScript sources; the app's bundler compiles them. What a consumer needs:

- A Vite + TypeScript build with `"moduleResolution": "bundler"` (the subpaths are `exports`). The sources
  type-check under the app's own flags, down to `lib: ES2020`. Vitest needs nothing extra.
- `react` for `./react`, `mermaid` for `./mermaid` (both peer dependencies). The core, `./check` and `./react` never
  load mermaid.
- Tailwind v4 scanning the package, since the card and the full view are styled with utilities on the app's tokens:

  ```css
  @source "../node_modules/@trick77/diagram/src";
  ```

  The classes use `bg-panel`, `bg-active`, `border-border`, `border-elevated-border`, `text-ink`, `text-ink-dim`,
  `text-faint`, `rounded-ui-sm`, `rounded-ui-lg` and `shadow-panel`. An app without one of them passes its own
  `classes`.

## Usage

**Core**: draw the IR, for example JSON a backend validated.

```ts
import { drawIR, fits, type DiagramIR } from "@trick77/diagram";

if (fits(ir)) {
  const { svg, layout } = await drawIR(ir, "app-diagram-1"); // layout: node boxes of a flow
}
```

`drawIR(ir, ids, { tree: false })` keeps a top-down tree on the general layout instead of drawing it as an org
chart; `{ palette }` passes colours instead of reading the page's tokens.

**`./mermaid`**: draw a mermaid source; the package's own drawing where it has one, mermaid's otherwise. Results
are cached by source.

```ts
import { configure, draw, drawnNow } from "@trick77/diagram/mermaid";

configure({ ids: "app-diagram" }); // once, before the first draw
const drawn = await draw(src); // { svg, own? } or { error }
const ready = drawnNow(src); // a finished drawing at once, null while there is none
```

**`./check`**: hold every diagram of an app's own corpus to the layout rules in a test, laid out as `drawIR` lays
it out, whatever its kind.

```ts
import { checkIR } from "@trick77/diagram/check";

expect(await checkIR(ir)).toEqual([]);
```

**`./react`**: the card in the text, and the full view behind its button. The app hands in its overlay shell,
icons and words.

```tsx
import { DiagramCard } from "@trick77/diagram/react";
import { fileName } from "@trick77/diagram";

<DiagramCard
  svg={drawn.svg}
  own={drawn.own}
  title="Sequence diagram"
  fileName={fileName("sequenceDiagram", "app")}
  shell={OverlayShell}
  icons={{ expand: <ExpandIcon />, download: <DownloadIcon /> }}
/>;
```

`own` says whose drawing it is: the package's brings its own canvas and gets a button row above it, mermaid's gets a
framed card with the buttons over its corner. It defaults to mermaid's; a drawing from `drawIR` passes `own`.

A timeline lies flat only where it fits, so its drawing depends on the room it is shown in. Pass `redraw` and the
card measures the text it sits in (the full view, the window) before it shows the drawing, and asks for the other
drawing when the room crosses the width the timeline lies flat at; the wrong one is never shown. Without it a timeline
stands up, which fits any column.

```tsx
<DiagramCard
  svg={drawn.svg}
  redraw={async (width) => {
    const d = await draw(src, { width });
    return "svg" in d ? d.svg : null;
  }}
  // ...
/>
```

## Theming

The drawing reads its colours and faces from `--diagram-*` custom properties on the page and writes them into the
SVG resolved, so a downloaded file looks the same. Every one must be defined; for example:

```css
:root {
  --diagram-surface: #151514; /* canvas and box fill */
  --diagram-fg: #ece8df; /* text */
  --diagram-muted: #a29e94; /* arrows, arrow labels */
  --diagram-line: #3b3935; /* frames */
  --diagram-tint: #201f1c; /* outcomes, zones */
  --diagram-accent: #d97757; /* the focus */
  --diagram-warn: #e3a33f; /* a dotted, optional arrow */
  --diagram-sans: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  --diagram-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
```

Box widths are budgeted for IBM Plex; another face may wrap a label a line early or late.

What mermaid draws itself takes its theme from the page's `--color-*` tokens (`themeVariables` in `./mermaid`), or
from `configure({ themeVariables })`.

## Used by

- [rongo](https://github.com/trick77/rongo)
- [almanach](https://github.com/trick77/almanach)
- [loom](https://github.com/trick77/loom)

## License

MIT

Some layout ideas for the tree, timeline, quadrant, swimlane and class diagrams were inspired by [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design).
