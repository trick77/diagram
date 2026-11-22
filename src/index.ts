// The core: IR, layouts, drawing, theme and export. No mermaid, no React.
export type {
  Card,
  ClassDiagramIR,
  ClassIR,
  ClassMemberIR,
  ClassRelIR,
  ClassRelKind,
  SwimlaneIR,
  DiagramIR,
  ERIR,
  EntityIR,
  FlowEdgeIR,
  FlowIR,
  FlowNodeIR,
  FlowShape,
  MindNodeIR,
  MindmapIR,
  RelIR,
  SeqHead,
  SeqLine,
  SeqRow,
  SequenceIR,
} from "./ir";
export { fits, limits, type Limits } from "./fits";
// The flow layout's parts too: a consumer's own layout (almanach's maps)
// is drawn by drawFlow on the same measures.
export {
  boxWidth,
  dotted,
  frame,
  isMapping,
  labelBox,
  lay,
  layoutElk,
  layoutFlow,
  layoutMapping,
  layoutSpine,
  looksLikeCode,
  margin,
  tidy,
  titleRoom,
  zonePad,
  type EdgeRoute,
  type Elk,
  type FlowLayout,
  type FlowOptions,
  type LabelBox,
  type NodeBox,
  type NodeKind,
  type Point,
  type ZoneBox,
} from "./layout";
export {
  layoutSequence,
  type SeqActor,
  type SeqFrame,
  type SeqLifeline,
  type SeqMessage,
  type SeqNote,
  type SequenceLayout,
  type TextBlock,
} from "./sequence";
export { isTree, layoutTree, treeChildren, treeLevels } from "./tree";
export { layoutER, type ERLayout, type Table, type TableRow } from "./er";
export {
  layoutMindmap,
  type MindBox,
  type MindLink,
  type MindmapLayout,
} from "./mindmap";
export {
  layoutClass,
  type ClassBox,
  type ClassLayout,
  type Mark,
  type MemberLines,
  type RelEnd,
} from "./class";
export {
  asFlow,
  layoutSwimlane,
  type LaneBox,
  type SwimlaneLayout,
} from "./swimlane";
export {
  drawClass,
  drawER,
  drawFlow,
  drawMindmap,
  drawSequence,
  drawSwimlane,
} from "./draw";
export {
  palette,
  ramp,
  textWidth,
  wrap,
  type Face,
  type Palette,
} from "./theme";
export { drawIR, engine, type DrawIROptions, type Rendered } from "./render";
export {
  download,
  fileName,
  phoneCanvas,
  pngScale,
  svgSize,
  toPng,
  toSvgFile,
  toXml,
  withGround,
} from "./export";
// Timeline and quadrant: drawings without boxes, and the room a timeline
// is shown in.
export type { PeriodIR, QuadrantIR, QuadrantPointIR, TimelineIR } from "./ir";
export {
  layoutTimeline,
  type Dot,
  type Segment,
  type TimelineLayout,
} from "./timeline";
export {
  layoutQuadrant,
  type QuadrantDot,
  type QuadrantLayout,
} from "./quadrant";
export type { PlotText, PlotTextKind } from "./plot";
export { drawQuadrant, drawTimeline } from "./draw";
export type { Room } from "./render";
export { flips, lie } from "./export";
