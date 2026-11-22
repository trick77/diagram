import { diagramKind } from "./kind";

/**
 * The gate in front of the mermaid renderer. A fence is model output, and
 * the model may have read a page written to steer it; the renderer reaches
 * the network on render, no click, for a handful of constructs (an image in
 * node data, a themeCSS in a directive or front matter, a url() in a style,
 * a C4 sprite or link) and reads its grammars widely (any case, `;` between
 * statements, front matter closed where a lenient reader would not, entity
 * codes it decodes). So a source naming any of these, anywhere, is not
 * drawn by the renderer at all, and the app shows it as code: refused, not
 * rewritten, since a rewrite for safety leaked and broke. What forRenderer
 * strips is no such rewrite: a directive's or front matter's config can
 * only set keys the renderer's config locks, so it is dropped as inert,
 * the gate judging what is left. Parsing fetches nothing; only render is
 * gated. The package's own drawing writes every IR text as escaped text
 * and needs no gate.
 */

/** The chars that end a tag's name here: whitespace, `/`, `>`, and the
 * quotes, `]`, `|`, `,` and parentheses a label or member puts after a
 * comparison (`A["x<y"]`, `cmp(a<b, eps=0.1)`). */
const nameEnd = /[\s/>"'\]|,()]/;

/** tagWithAttribute says a text holds a tag with an attribute: `<` and a
 * letter start it, its name runs to a nameEnd char (an inner `<` or `.`
 * is part of it: `x<img< onerror=`, `x<a.b onclick=`) that must be
 * whitespace or `/`, and an `=` after that before the `>` that closes it
 * is an attribute's, an inner `<` no end. A generic never has an `=` in
 * its brackets (`Map<String, Object>`, `<<interface>>`), and
 * `a < b and c = d` is no tag. A regex stopping at an inner `<` let
 * `x<img x< onerror=…>` pass, and a backtracking one took seconds on a
 * long line: one right-to-left pass records the next `>`, `=` and name
 * end for every position. */
function tagWithAttribute(text: string): boolean {
  const n = text.length;
  const gt = new Int32Array(n + 1).fill(n);
  const eq = new Int32Array(n + 1).fill(n);
  const end = new Int32Array(n + 1).fill(n);
  for (let i = n - 1; i >= 0; i--) {
    const c = text[i];
    gt[i] = c === ">" ? i : gt[i + 1];
    eq[i] = c === "=" ? i : eq[i + 1];
    end[i] = nameEnd.test(c) ? i : end[i + 1];
  }
  for (let i = 0; i + 1 < n; i++) {
    if (text[i] !== "<" || !/[a-z]/i.test(text[i + 1])) continue;
    const at = end[i + 1];
    if (at < n && /[\s/]/.test(text[at]) && eq[at] < gt[at]) return true;
  }
  return false;
}

/** The tags that act bare, lower case only: a capital one (`<SCRIPT>`,
 * `<Link>`, `<Form>`) is text with HTML labels locked off, the source
 * rules being a second line behind that lock. */
const acting =
  "script|iframe|frame|embed|style|base|meta|form|noscript|template|object|link";

/** What the renderer is refused for in any kind, matched against the whole
 * source and against it decoded (decodings). Wide on purpose: a false
 * refusal shows code, a missed one fetches. */
const refused: [RegExp | ((text: string) => boolean), string][] = [
  // A CSS url(), not an identifier ending in url (`ParseURL(`), nor an
  // empty one (`URL()`).
  [/(?<!\w)url\s*\(\s*(?!\))/i, "a url()"],
  [/image-set|cross-fade/i, "a CSS image function"],
  [/@import/i, "an @import"],
  [/https?:/i, "a URL"],
  [/\/\//, "a // URL"],
  [/%%\s*\{/, "a directive"],
  [/@\s*\{/, "node data"],
  [/\$(link|sprite|tags)\b/i, "a C4 link, sprite or tag"],
  [/\bUpdate(Element|Rel|Boundary)Style|UpdateLayoutConfig/i, "a C4 style"],
  [/\\/, "a backslash escape"],
  // Any tag with any attribute: a per-tag list leaked (a valueless
  // attribute first, a quoted `>`, a handler far in) and refused generics.
  [tagWithAttribute, "markup with an attribute"],
  // An acting tag in lower case after anything (`List<script>`), but a
  // UML stereotype, `<` before and `>>` after (`<<template>>`).
  [
    new RegExp(`(?<!<)<(?:${acting})\\b|<(?:${acting})\\b(?!>>)`),
    "markup that acts",
  ],
  [/href/i, "an href"],
  // As attributes only: "Posters and social media" is a label. Inside a
  // name too (`imagesrcset=`).
  [/src\s*=|srcset\s*=|\b(poster|background)\s*=/i, "an attribute that loads"],
  [/javascript:/i, "a javascript: URL"],
  [/\bdata:[a-z]+\//i, "a data: URL"],
];

/** styleSemicolons is a text as mermaid's encodeEntities first leaves it:
 * `/style.*:\S*#.*;/g`, then the same for classDef, each match losing its
 * last char. Read in one pass per line, as those regexes are quadratic (a
 * line of `style ` words). A line whose first `word` is followed by a
 * `:`, a run without whitespace and a `#` before its last `;` loses that
 * `;`: the match runs from the first `word` to the line's last `;`. A
 * line ends where `.` stops: \n, \r, U+2028, U+2029. Exported for the
 * test against mermaid's own regexes. */
const lines = new RegExp(
  `[^\\n\\r${String.fromCharCode(0x2028, 0x2029)}]+`,
  "g",
);
export function styleSemicolons(text: string): string {
  const drop = (t: string, word: string) =>
    t.replace(lines, (line) => {
      const at = line.indexOf(word);
      const last = line.lastIndexOf(";");
      if (at < 0 || last < 0) return line;
      let colon = false;
      for (let i = at + word.length; i < last; i++) {
        const c = line[i];
        if (/\s/.test(c)) colon = false;
        else if (c === ":") colon = true;
        else if (c === "#" && colon)
          return line.slice(0, last) + line.slice(last + 1);
      }
      return line;
    });
  return drop(drop(text, "style"), "classDef");
}

/** mermaid's own character codes, as its encodeEntities reads them: a `;`
 * ending a style or classDef line with a `#` after its `:` is no code's
 * (`fill:#ffe9a8;`; case-sensitive, linkStyle not), then any `#\w+;` is
 * one, `&#n;` for digits, `&name;` else (`#x3a;` names nothing). Its
 * decodeEntities then turns its placeholders back, `ﬂ°°` into `&#`, `ﬂ°`
 * into `&`, `¶ß` into `;`, whoever wrote them. */
function mermaidCodes(src: string): string {
  return styleSemicolons(src)
    .replace(/#(\w+);/g, (_, c: string) =>
      /^\d+$/.test(c) ? `&#${c};` : `&${c};`,
    )
    .replace(/ﬂ°°/g, "&#")
    .replace(/ﬂ°/g, "&")
    .replace(/¶ß/g, ";");
}

/** The names a source can use without a document to read them by. */
const named: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/** A numeric code as the browser reads it, leading zeros and all. */
function numeric(digits: string, radix: number): string {
  const d = digits.replace(/^0+/, "");
  const n = d.length > 8 ? Infinity : parseInt(d || "0", radix);
  return n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)
    ? "�"
    : String.fromCodePoint(n);
}

/** htmlDecoded is a text with its HTML character references read once, as
 * the browser reads them (a `;` optional), or null when it names one
 * without a document to read it by: refused. A name read through a
 * textarea, whose content is never parsed as elements. */
function htmlDecoded(text: string): string | null {
  let unread = false;
  let area: HTMLTextAreaElement | undefined;
  const out = text.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));?/gi,
    (m, dec?: string, hex?: string, name?: string) => {
      if (dec !== undefined) return numeric(dec, 10);
      if (hex !== undefined) return numeric(hex, 16);
      const n = name ?? "";
      // The names escapeAngles writes by the thousand, without a document.
      if (m.endsWith(";") && Object.prototype.hasOwnProperty.call(named, n))
        return named[n];
      if (typeof document !== "undefined") {
        area ??= document.createElement("textarea");
        area.innerHTML = m;
        return area.value;
      }
      if (m.endsWith(";")) {
        // HTML also knows the four legacy names in capitals (`&LT;`).
        const key = /^(LT|GT|AMP|QUOT)$/.test(n) ? n.toLowerCase() : n;
        if (Object.prototype.hasOwnProperty.call(named, key)) return named[key];
        unread = true;
        return m;
      }
      // Without a `;` the browser reads only a legacy name (`&lt`, `&amp`).
      const legacy = /^(lt|gt|amp|quot)/i.exec(n);
      return legacy
        ? named[legacy[1].toLowerCase()] + n.slice(legacy[1].length)
        : m;
    },
  );
  return unread ? null : out;
}

/** decodings are a source as the renderer may show it: its mermaid codes
 * read, then its HTML codes, once and again while they change (a code
 * spelling a code), every one of them judged; null, refused, for a code
 * it cannot read or one still changing after a few rounds. */
function decodings(src: string): string[] | null {
  let text = mermaidCodes(src);
  const out = text === src ? [] : [text];
  for (let i = 0; i < 4; i++) {
    const next = htmlDecoded(text);
    if (next === null) return null;
    if (next === text) return out;
    out.push(next);
    text = next;
  }
  return null;
}

/** A click binding or a link, in the kinds whose grammar has one as a
 * statement: anywhere else `click` and `link` are words. After a `;` that
 * ends a statement: mermaid consumes `#\w+;` as a code, nothing else (`&x;`
 * ends one), and a flowchart's quoted text is a label. */
const statements: [RegExp, string][] = [
  [/^[^\S\n]*click\b|(?<!#\w+);\s*click\b/im, "a click binding"],
  [/^[^\S\n]*links?\b|(?<!#\w+);\s*links?\b/im, "a link"],
];
const withStatements = (kind: string) =>
  kind === "graph" ||
  kind.startsWith("flowchart") ||
  kind === "sequenceDiagram" ||
  kind.startsWith("classDiagram");

/** forRenderer is a source as draw hands it to the renderer, the gate
 * judging this form:
 * - Line breaks as the renderer reads them (a bare `\r` is one).
 * - `%%{…}%%` directives and front matter but its title emptied, line by
 *   line so an error keeps its line number, as the
 *   renderer reads them (a directive never closed runs to the end; front
 *   matter closes at the first `---` at a line's start). Their config could
 *   only set what the renderer's config locks (mermaidConfig: secure), and
 *   the fetch oracle in the tests shows a directive or front matter does not
 *   load anything once locked; stripped, an answer asking for a dark theme
 *   still draws, where refusing it showed code.
 * - The formatting tags escapeAngles keeps as markup (`<b>`, `<code>`, an
 *   attribute-less `<span>` ...) taken out: with HTML labels off the
 *   renderer drew them as their text. A line break stays where the kind
 *   draws one: a pie draws none (a space), a timeline only `<br>`. */
export function forRenderer(written: string): string {
  let src = written.replace(/\r\n?/g, "\n");
  src = stripDirectives(src);
  src = titleOnly(src);
  src = src
    .replace(/<\/?(?:b|i|u|em|strong|code|sub|sup|small|s|del|ins|mark)>/g, "")
    // A span only in an attribute-less pair: a styled one's text stays
    // whole, drawn as text.
    .replace(/<span>([^<]*)<\/span>/g, "$1");
  const kind = diagramKind(src);
  if (kind === "pie") src = src.replace(/<br\s*\/?>/gi, " ");
  if (kind === "timeline") src = src.replace(/<br\s*\/?>/gi, "<br>");
  return src === written ? written : src;
}

/** stripDirectives cuts every `%%{ … }%%`, to the end of the text when it
 * is never closed, as the renderer's own reading does. */
function stripDirectives(src: string): string {
  if (!src.includes("%%{")) return src;
  let out = "";
  let i = 0;
  for (;;) {
    const at = src.indexOf("%%{", i);
    if (at < 0) return out + src.slice(i);
    out += src.slice(i, at);
    const end = src.indexOf("}%%", at + 3);
    const cut = end < 0 ? src.slice(at) : src.slice(at, end + 3);
    out += cut.replace(/[^\n]/g, "");
    if (end < 0) return out;
    i = end + 3;
  }
}

/** titleOnly keeps of front matter its one-line title, or drops it, where
 * the renderer reads it as front matter: `---` as the first line, closed by
 * the next line that is `---` from its start. */
function titleOnly(src: string): string {
  const lines = src.split("\n");
  if (!/^---[ \t]*$/.test(lines[0])) return src;
  const close = lines.findIndex((l, i) => i > 0 && /^---[ \t]*$/.test(l));
  if (close < 0) return src;
  const yaml = lines.slice(1, close);
  // A plain one-line title; a block scalar's (`|`, `>`) is dropped whole.
  const title = yaml.find((l) => /^title:[ \t]*[^\s|>][^\n]*$/.test(l));
  if (title !== undefined && yaml.every((l) => l === title)) return src;
  // Every line kept, emptied: a parse error names the fence's own line.
  const at = title === undefined ? -1 : yaml.indexOf(title);
  const head =
    title === undefined
      ? lines.slice(0, close + 1).map(() => "")
      : ["---", ...yaml.map((l, i) => (i === at ? l : "")), "---"];
  return [...head, ...lines.slice(close + 1)].join("\n");
}

/** unsafeSource is why the renderer must not draw a source, null when it
 * may. Line breaks are read as the renderer reads them (a bare `\r` is
 * one). The refused rules judge it as written and decoded. Front matter
 * may hold a title and nothing else, in exactly the form the renderer
 * reads: the first line `---`, a `title:` line among blank ones, `---`. */
export function unsafeSource(written: string): string | null {
  const src = written.replace(/\r\n?/g, "\n");
  const hits = (rule: (typeof refused)[number][0], text: string) =>
    typeof rule === "function" ? rule(text) : rule.test(text);
  for (const [rule, why] of refused) if (hits(rule, src)) return why;
  const decoded = decodings(src);
  if (decoded === null) return "a character code it cannot read";
  for (const text of decoded)
    for (const [rule, why] of refused)
      if (hits(rule, text)) return `${why}, by a character code`;
  const kind = diagramKind(src);
  if (withStatements(kind)) {
    // A flowchart's quoted text is a string token; a sequence message
    // ends at a `;`, quoted or not.
    const flow = kind === "graph" || kind.startsWith("flowchart");
    const text = flow ? src.replace(/"[^"\n]*"/g, '""') : src;
    for (const [re, why] of statements) if (re.test(text)) return why;
  }
  const lines = src.split("\n");
  const fences = lines.filter((l) => l.trim() === "---").length;
  if (fences === 0) return null;
  // Blank lines stand where forRenderer took config out.
  const first = lines.findIndex((l) => l.trim() !== "");
  const close = lines.findIndex((l, i) => i > first && l.trim() === "---");
  const yaml = lines.slice(first + 1, close).filter((l) => l.trim() !== "");
  const ok =
    fences === 2 &&
    lines[first] === "---" &&
    lines[close] === "---" &&
    (yaml.length === 0 ||
      (yaml.length === 1 && /^title:[^\n]*$/.test(yaml[0])));
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
 * - a srcset, poster or background attribute, an on… handler;
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
      if (name.startsWith("on")) return `an ${name} handler`;
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
