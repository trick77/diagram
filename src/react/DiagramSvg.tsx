import type { ReactNode } from "react";

/** DiagramSvg is the drawing itself: the SVG carries a viewBox and its own
 * width, so it fits a narrow column by scaling down and never grows past
 * 1:1. Block, so the card holds no inline-box gap under it.
 *
 * innerHTML from model text: safe because the package's drawing writes
 * every label through draw.ts's XML escape, and the mermaid renderer runs
 * with securityLevel "strict" (./mermaid draw). */
export function DiagramSvg({
  svg,
  title,
}: {
  svg: string;
  title: string;
}): ReactNode {
  return (
    // font-sans explicitly: the drawing sits inside prose (serif in some
    // apps), and a node label is a name from the code, not prose.
    <div
      className="diagram-svg font-sans [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-full"
      role="img"
      aria-label={title}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
