# diagram

Diagram layout and SVG drawing for the browser, one copy for rongo, almanach and loom (npm `@trick77/diagram`).

## Working conventions

- TDD. English only. Never commit to master: branch + PR.
- Commit subjects + PR titles: Go style `area: what` (`layout: …`, `draw: …`), gated by ship; release notes list them by area.
- Fresh clone: `ship hooks` before the first push (check, conform and init install it too); without the pre-push hook a push skips the gate.
- Gate: `make check` (`ship check`), UI floor 75: raise tests, never a floor.
- Release by hand: `gh workflow run Release -f bump=auto` tags `vX.Y.Z`; on success `publish.yaml` publishes it
  to npm (trusted publishing, OIDC, environment `npm-publish`, no token). Version from the tag, package.json stays
  `0.0.0`. A tag npm missed: `gh workflow run Publish -f tag=vX.Y.Z`. npm trusts a publisher only on an existing
  package: 0.1.0 went out by hand (`npm publish` from the tag), then npmjs.com got the publisher (repo
  trick77/diagram, that workflow + environment). Dependabot bumps the consumers.
- Consumers import the TS sources, no build step: `exports` at `src/`. Sources type-check under lib ES2020 (loom): no `Array.at`/`replaceAll`.
- `.`, `./check`, `./react` never import mermaid, not even transitively: almanach installs none.
- README screenshots: `npx playwright install chromium` once, then `npx vitest run --config scripts/vitest.config.ts`
  (unsandboxed) redraws `docs/img/*.png`; fails on a missing Plex face/weight, no fallback font.

## Contracts

- IR (`src/ir.ts`): almanach's Go validator (`internal/diagram`, `baseline/diagram.go`, `diagram.MapMax*`) mirrors
  the kinds almanach draws (flow, sequence, er). New kind (mindmap, timeline, …) = additive, no almanach change.
  Changed field of an existing kind = breaking minor + almanach Go PR. Its map caps (22 nodes, 33 edges),
  frame-counting rows and `{ tree: false }` (flows stay on the engine) reach the package as options.
- Prompt rules live in the consumers (rongo `answerDiagram`, loom's prompt): a layout change can need one there.
  Judged on a number, never a hunch: a negative trigger drew 1 diagram in 19 answers, a positive one 13
  (rongo `2026-09-17-ba-diagrams.md`).

## Diagram failing to draw → corpus FIRST

- New `testdata/diagrams/*.mmd` in the failing shape, then the fix; past the caps on purpose → `declined`, a tree
  → `orgCharts`, lanes → `swimlanes`, still refused → `refused`, breaks the rules → `broken` (`corpus.test.ts`).
  Consumers run theirs on `./check` `checkIR`. Misshapen source → `repair` (text.ts); an own drawing `checkIR`
  refuses goes to mermaid, never out broken.
- Public repo: invented labels only, never a name or text from a real answer.

## Traps (each cost a broken picture)

- Labels in double quotes: a bracket in an unquoted label is syntax, the strict parser drops the whole picture.
- Trigger → target: the target is ONE node. Drawn twice, the renderer invented an order.
- Colour only from the source (`:::focus`, dotted arrow, loop back), never inferred. Models marked focus on 9 of 9
  flowcharts, always the nodes asked about; 2 of 4 runs also wrote a stray `:::focus` line → `dropStrayMarks`.
- Never wider than the text it sits in: wider read as out of place. Scaled down, never scrolled; full view for
  size. Buttons ABOVE an own drawing (over it they hid a sequence's last participant), over a mermaid card's corner.
- Angle brackets: mermaid's sanitiser eats `<url>` (`Failed to fetch <url>: <cause>` drew `Failed to fetch :`).
  Escaped on the way to the parser (`escapeAngles`), never by prompt: a prompt line measured no gain (0 of 41
  fences used brackets) and fixes no stored answer.
- Own drawing first, mermaid only for what it declines (`ownKinds`, `fits`); the corpus asserts which, per file.
  Anything thrown in the own path falls back to mermaid, never a failed picture.
- `draw` caches drawings, never a refusal: a chunk gone after a redeploy must not stick all session.
- `toIR` alone reads mermaid's internals (the parse db): a mermaid bump breaks there and in the corpus test.
- Fences may be injected: renderer path fails closed (guard.ts); a safety rewrite leaked and broke.

## Measured constants (rongo docs/measurements 2026-10-25; digits 2026-11-22)

- Text width is a budget, not a page measurement: same under jsdom and before the font loads. Chrome, IBM Plex:
  sans 0.46-0.50em at 400, up to 0.52 at 600 → budget 0.56; mono 0.60 exact; sans capitals 0.60-0.66 → 0.68 (at
  0.56 a capital label ran ~15% past its box); sans digits tabular, 0.60 exact at 400/600. The first budget, 0.60 for
  both, wrapped every main-path box a line early. A non-Plex page font needs its own budget, or boxes break wrong.
- Mermaid's theme: frames `--color-faint`; the border token drew 1.3:1 on a node fill, invisible, faint 4:1.
- Canvas: desktop 16384 side; iOS Safari ~16.7M px whatever the side (`phoneCanvas`); past it a PNG is empty.
