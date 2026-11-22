/** frontMatter is mermaid's leading YAML block (`---`, YAML, `---`): the
 * lines it takes, 0 for none or an unclosed one, and its `title:` when that
 * is a plain one-line value, "" otherwise. */
export function frontMatter(src: string): { lines: number; title: string } {
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || lines[i].trim() !== "---")
    return { lines: 0, title: "" };
  let end = -1;
  for (let k = i + 1; k < lines.length; k++)
    if (lines[k].trim() === "---") {
      end = k;
      break;
    }
  if (end < 0) return { lines: 0, title: "" };
  let title = "";
  for (const l of lines.slice(i + 1, end)) {
    const m = /^title:\s*(.*?)\s*$/.exec(l);
    if (m) title = m[1].replace(/^(["'])(.*)\1$/, "$2");
  }
  return { lines: end + 1, title };
}

/** diagramKind is the first word of the source, which is the diagram type in
 * mermaid's grammar: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`.
 * Leading front matter, a `%%{init}%%` directive and comments are skipped.
 * Empty when there is no such word, or when the word is not the shape of a
 * type name. A backend reading fences (rongo's renumber.go mermaidKind)
 * reads it the same way.
 *
 * A module of its own so the pure text helpers (text.ts) can read it
 * without loading the renderer. */
export function diagramKind(src: string): string {
  const lines = src.split("\n").slice(frontMatter(src).lines);
  for (const line of lines) {
    const t = line.trim();
    if (t === "" || t.startsWith("%%")) continue;
    const word = t.split(/\s+/)[0].replace(/[;:]$/, "");
    return /^[A-Za-z][A-Za-z0-9-]*$/.test(word) ? word : "";
  }
  return "";
}
