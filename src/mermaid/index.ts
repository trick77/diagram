// mermaid sources: read into the IR, drawn by the package where it can and
// by the mermaid renderer (an optional peer dependency) where it cannot.
export { toIR, plain } from "./ir";
export { editorial, type Parser } from "./editorial";
export { diagramKind, frontMatter } from "./kind";
export { dropStrayMarks, escapeAngles, repair } from "./text";
export {
  configure,
  diagramTitle,
  draw,
  drawnNow,
  ownKinds,
  themeVariables,
  titles,
  type DrawOptions,
  type Drawn,
} from "./draw";
// fits lives in the core (a JSON IR needs it too); here as well, beside
// toIR, where a mermaid consumer looks for it.
export { fits, limits, type Limits } from "../fits";
