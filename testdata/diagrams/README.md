Diagram sources as models wrote them, one file per shape that has been seen. The labels are invented; the shapes
(node and edge counts, branches, `:::focus` marks, angle brackets, umlauts) are the ones that broke something.

A diagram that fails to draw gets its source dropped in here as a new `.mmd` FIRST, and the fix afterwards.
`src/mermaid/corpus.test.ts` checks every file: the renderer's own parser accepts it (as written, and with its
angle brackets escaped), the kinds the package draws come out as `<svg`, every bracket reaches a label, the layout
passes `check`, and `:::focus` frames exactly the marked nodes.

Some files carry an expectation of their own, listed by name in the test: `declined` (a kind the package draws, past
its limits on purpose, so the renderer draws it), `orgCharts` (the trees the org chart draws), `swimlanes` (the
flowcharts read as lanes; no other flowchart may read as one), `refused` (the renderer refuses it even repaired) and
`broken` (within the limits but laid out against the rules, so the renderer draws it). The last two are asserted the
other way round: the fix that learns one flips its test, and the entry goes.
