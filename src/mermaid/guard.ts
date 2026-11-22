import { diagramKind } from "./kind";

/**
 * The gate in front of the mermaid renderer. A fence is model output, and
 * the model may have read a page written to steer it; the renderer reaches
 * the network on render, no click, for a handful of constructs (an image in
 * node data, a themeCSS in a directive or front matter, a url() in a style,
 * a C4 sprite or link) and reads its grammars widely (any case, `;` between
 * statements, front matter closed where a lenient reader would not, entity
 * codes it decodes). So nothing is rewritten for safety, which leaks or
 * breaks: a source naming any of these, anywhere, is not drawn by the
 * renderer at all, and the app shows it as code. Parsing fetches nothing;
 * only render is gated. The package's own drawing writes every IR text as
 * escaped text and needs no gate.
 */

/** The tags that load, or carry what does. */
const tags =
  "img|image|picture|source|video|audio|track|input|a|link|style|svg|use|script|iframe|frame|embed|object|base|meta|form";

/** What the renderer is refused for in any kind, matched case-insensitively
 * against the whole source. Wide on purpose: a false refusal shows code, a
 * missed one fetches. */
const refused: [RegExp, string][] = [
  [/url\s*\(/i, "a url()"],
  [/image-set|cross-fade/i, "a CSS image function"],
  [/@import/i, "an @import"],
  [/https?:/i, "a URL"],
  [/\/\//, "a // URL"],
  [/%%\s*\{/, "a directive"],
  [/@\s*\{/, "node data"],
  [/\$(link|sprite|tags)\b/i, "a C4 link, sprite or tag"],
  [/\bUpdate(Element|Rel|Boundary)Style|UpdateLayoutConfig/i, "a C4 style"],
  [/\\/, "a backslash escape"],
  // A numeric character code, mermaid's (`#58;`) or HTML's (`&#58;`): the
  // renderer decodes it, a `:` or a `<` past every rule here.
  [/#x?[0-9a-f]+;/i, "a character code"],
  // As written or as the entity codes escapeAngles writes and the renderer
  // turns back into the character. Straight after the bracket, so prose
  // (`x < a second`) passes.
  [new RegExp(`(?:<|#lt;|&lt;)/?(?:${tags})\\b`, "i"), "markup that loads"],
  [/href/i, "an href"],
  [/src\s*=|srcset|poster|background\s*=/i, "an attribute that loads"],
  [/javascript:/i, "a javascript: URL"],
  [/\bdata:[a-z]+\//i, "a data: URL"],
];

/** A click binding or a link, in the kinds whose grammar has one as a
 * statement: anywhere else `click` and `link` are words. */
const statements: [RegExp, string][] = [
  [/^[^\S\n]*click\b|;\s*click\b/im, "a click binding"],
  [/^[^\S\n]*links?\b|;\s*links?\b/im, "a link"],
];
const withStatements = (kind: string) =>
  kind === "graph" ||
  kind.startsWith("flowchart") ||
  kind === "sequenceDiagram" ||
  kind.startsWith("classDiagram");

/** unsafeSource is why the renderer must not draw a source, null when it
 * may. Line breaks are read as the renderer reads them (a bare `\r` is
 * one). Front matter may hold a title and nothing else, in exactly the form
 * the renderer reads: the first line `---`, a `title:` line, `---`. */
export function unsafeSource(written: string): string | null {
  const src = written.replace(/\r\n?/g, "\n");
  for (const [re, why] of refused) if (re.test(src)) return why;
  if (withStatements(diagramKind(src)))
    for (const [re, why] of statements) if (re.test(src)) return why;
  const lines = src.split("\n");
  const fences = lines.filter((l) => l.trim() === "---").length;
  if (fences === 0) return null;
  const first = lines.findIndex((l) => l.trim() !== "");
  const ok =
    fences === 2 &&
    lines[first] === "---" &&
    ((/^title:[^\n]*$/.test(lines[first + 1]) && lines[first + 2] === "---") ||
      lines[first + 1] === "---");
  return ok ? null : "front matter beyond a title";
}

/** A CSS text that loads: a url() to anything but `#…`, an image function,
 * an @import, a backslash escape. */
function cssLoads(text: string): boolean {
  if (/@import|image-set|cross-fade|\\/i.test(text)) return true;
  const all = (text.match(/url\s*\(/gi) ?? []).length;
  const local = (text.match(/url\s*\(\s*["']?#/gi) ?? []).length;
  return all > local;
}

/** unsafeSvg is why a drawing the renderer made must not be shown, null
 * when it may. The second line behind unsafeSource:
 * - an element that loads by its nature (script, iframe, object ...);
 * - an src, href or xlink:href to anything but `#…` (an inline
 *   `data:image/` on an image is its own picture: C4's person icon);
 * - a srcset, poster or background attribute;
 * - any other attribute naming a scheme (`x:`) or `//`;
 * - a stylesheet or style attribute that loads (cssLoads). */
export function unsafeSvg(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, "text/html");
  for (const s of doc.querySelectorAll("style"))
    if (cssLoads(s.textContent ?? "")) return "a stylesheet loads";
  for (const el of doc.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    if (/^(script|iframe|frame|object|embed|link|base|meta|form)$/.test(tag))
      return `a <${tag}>`;
    for (const a of el.attributes) {
      const name = a.name.toLowerCase();
      const v = a.value.trim();
      if (name.startsWith("xmlns")) continue;
      if (/^(srcset|poster|background)$/.test(name)) return `a ${name}`;
      if (name === "style") {
        if (cssLoads(v)) return `a <${tag}> style loads`;
        continue;
      }
      if (/^(src|href|xlink:href)$/.test(name)) {
        if (v.startsWith("#")) continue;
        if (/^(image|img)$/.test(tag) && /^data:image\//i.test(v)) continue;
        return `a <${tag}> loads`;
      }
      if (/[a-z][a-z0-9+.-]*:/i.test(v) || v.includes("//") || cssLoads(v))
        return `a <${tag}> ${name}`;
    }
  }
  return null;
}
