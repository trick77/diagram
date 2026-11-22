// The layout quality gate, for corpus tests: the package's and each
// consumer's own.
export {
  check,
  checkClass,
  checkER,
  checkMindmap,
  checkSequence,
  checkSwimlane,
  minLabelGap,
} from "./check";
export { checkQuadrant, checkTimeline } from "./plot";
export { checkIR, type AnyLayout, type CheckIROptions } from "./ir";
