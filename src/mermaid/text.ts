import { diagramKind, frontMatter } from "./kind";

/**
 * Angle brackets in a diagram's text, kept as text.
 *
 * mermaid's sanitiser takes anything in angle brackets for a tag and drops
 * it, in the package's drawing and its own alike: a message written `Failed to
 * fetch <url>: <cause>` drew as `Failed to fetch :`, a guard `retries < 3`
 * lost its tail, `Repository<S>` lost its parameter. There is no switch in
 * the renderer that keeps them, so on the way to drawing every `<` and `>`
 * in the text is written as the renderer's entity code, which it turns back
 * into the character.
 *
 * "The text" is found by grammar, not by a parser: quoted strings, and per
 * kind the unquoted forms the model writes. A flowchart's node labels in
 * their shapes, `|edge labels|`, `-- edge labels -->` in their arrow forms
 * and subgraph titles; what follows a sequence line's keyword or a message's
 * colon; a state, class or entity line's text after its colon, a state
 * note's body and a class body's members; a mindmap's node lines whole.
 * Arrows (`-->`, `->>`), `:::class`
 * shorthands and the formatting tags the renderer honours (`<br>` in any
 * case, `<b>`, `<code>` ... exact and lowercase, `<span ...>`) are never
 * touched.
 *
 * Two ways a form can still be missed. One this escapes into something the
 * renderer refuses: draw() then draws the source as written and warns. One
 * this does not recognise at all: it parses as written and its brackets are
 * dropped as they always were, silently; a new form seen in an answer goes
 * into the diagram corpus first.
 *
 * Applied on the way to drawing only; the stored fence and what Copy as
 * Markdown copies stay as the model wrote them.
 */

/** A formatting tag the renderer honours, kept as markup. A line break in
 * any case, as the renderer and plain() both read it; the inline tags only
 * exact and lowercase, so `<S>`, `<I, V>`, `<Code>` and `<b and c>` are text;
 * attributes only on a span. */
const markup = [
  /^<\/?br\s*\/?>/i,
  /^<\/?(?:b|i|u|em|strong|code|sub|sup|small|s|del|ins|mark)>/,
  /^<\/?span(?:\s[^<>]*)?>/,
];

/** entityAngles writes the brackets of one piece of text as the renderer's
 * entity codes, leaving the formatting tags in it alone. (Not ../draw.ts's
 * XML escape: this one is for the source on its way to the parser.) */
function entityAngles(s: string): string {
  let out = "";
  for (let i = 0; i < s.length;) {
    if (s[i] === "<") {
      const rest = s.slice(i);
      const tag = markup.map((r) => r.exec(rest)).find((m) => m !== null);
      if (tag) {
        out += tag[0];
        i += tag[0].length;
        continue;
      }
      out += "#lt;";
    } else if (s[i] === ">") {
      out += "#gt;";
    } else {
      out += s[i];
    }
    i++;
  }
  return out;
}

/** quotedIn escapes every double-quoted string of one piece of source. */
function quotedIn(src: string): string {
  return src.replace(/"([^"]*)"/g, (_, s: string) => `"${entityAngles(s)}"`);
}

/** quotedAcross escapes the double-quoted strings of a flowchart, whose
 * markdown labels may run over several lines: a label's closing quote is
 * found by scanning, never by pairing the quotes of one line, which paired
 * a label's end with the next one's start and escaped the arrow between.
 * Comment lines are passed over: a quote there is free text. */
function quotedAcross(src: string): string {
  const lines = src.split("\n");
  const code = lines.map((l) => (l.trim().startsWith("%%") ? "" : l));
  const joined = code.join("\n");
  let out = "";
  let i = 0;
  while (i < joined.length) {
    const open = joined.indexOf('"', i);
    if (open < 0) break;
    const close = joined.indexOf('"', open + 1);
    if (close < 0) break;
    out +=
      joined.slice(i, open + 1) +
      entityAngles(joined.slice(open + 1, close)) +
      '"';
    i = close + 1;
  }
  const done = (out + joined.slice(i)).split("\n");
  return done.map((l, k) => (code[k] === "" ? lines[k] : l)).join("\n");
}

/** A line's own colon: not part of a `:::class` shorthand. */
const ownColon = /(?<!:):(?!:)/;

/** afterColon escapes what follows a line's own colon. */
function afterColon(line: string): string {
  const m = ownColon.exec(line);
  if (!m) return line;
  return line.slice(0, m.index + 1) + entityAngles(line.slice(m.index + 1));
}

/** Shapes a flowchart node's label sits in, outermost delimiters first. `>`
 * opens the asymmetric shape; it only counts right after a node id, which
 * an arrow's `>` never is. */
const shapes: [string, string][] = [
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["((", "))"],
  ["{{", "}}"],
  ["[/", "/]"],
  ["[\\", "\\]"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  [">", "]"],
];

/** The edge label written into its arrow: `A -- text --> B`, `A--text-->B`,
 * `A == text ==> B`, `A -. text .-> B`, with an arrowhead, a cross, a circle
 * or none. */
const inlineEdge =
  /((?:^|[\s\w\])}])(?:--|==|-\.)(?![->=.])\s*)([^"|]*?)(\s*(?:-->|--x|--o|---|==>|==x|==o|===|\.->|-\.-))/g;

/** flowchartLine escapes the unquoted text of one flowchart line: node
 * labels inside their shape, `|edge labels|`, labels written into an arrow,
 * and a subgraph's title. Quoted text is already done and is passed over. */
function flowchartLine(line: string): string {
  const t = line.trimStart();
  if (/^subgraph\b/.test(t)) {
    const lead = line.length - t.length;
    const m = /^subgraph\s+(\S+)(.*)$/.exec(t);
    if (!m) return line;
    return line.slice(0, lead) + `subgraph ${m[1]}` + entityAngles(m[2]);
  }
  let out = line.replace(
    /\|([^|"]*)\|/g,
    (_, s: string) => `|${entityAngles(s)}|`,
  );
  out = out.replace(
    inlineEdge,
    (_, a: string, s: string, b: string) => a + entityAngles(s) + b,
  );
  // An unquoted label inside its shape, right after a node id. An id never
  // ends in `-`: `A-->B` read as `A--` took the arrow's `>` for the
  // asymmetric shape and escaped the next arrow into text.
  let res = "";
  let i = 0;
  const id = /[A-Za-z0-9_](?:[\w-]*\w)?/y;
  while (i < out.length) {
    id.lastIndex = i;
    const m = id.exec(out);
    if (!m) {
      res += out[i++];
      continue;
    }
    const at = i + m[0].length;
    res += m[0];
    i = at;
    const shape = shapes.find(([o]) => out.startsWith(o, at));
    if (!shape || out[at + shape[0].length] === '"') continue;
    const [o, c] = shape;
    const end = out.indexOf(c, at + o.length);
    if (end < 0) continue;
    res += o + entityAngles(out.slice(at + o.length, end)) + c;
    i = end + c.length;
  }
  return res;
}

/** The words that open a sequence line whose remainder is text: only a word
 * standing alone, followed by a space, a colon or the line's end. A
 * participant named `Title` sending `Title->>A` is a message, not a title. */
const sequenceWords =
  /^(\s*)(alt|else|opt|loop|par|and|critical|option|break|rect|box|participant|actor|create participant|create actor|note|title)(?=\s|:|$)(.*)$/i;

/** dropStrayMarks removes a line holding a class mark and nothing else,
 * `:::focus` on its own. The prompt asks for a mark right after a node, and
 * a model has written one more on a line of its own after the last edge;
 * the renderer refuses the whole source over it, and the mark marks
 * nothing, so dropping it costs nothing a reader would see. Never attached
 * to the node above instead: in the one seen the node above was the last
 * edge's target, not the node the question was about, and the accent is
 * only ever the model's own word. A flowchart only: in a mindmap a mark on
 * the line after a node is how that node takes a class. */
export function dropStrayMarks(src: string): string {
  if (!src.includes(":::")) return src;
  const kind = diagramKind(src);
  if (kind !== "graph" && !kind.startsWith("flowchart")) return src;
  return src
    .split("\n")
    .filter((l) => !/^\s*:::[A-Za-z][\w-]*\s*;?\s*$/.test(l))
    .join("\n");
}

/**
 * repair mends the shapes models write that the renderer refuses, into what
 * they meant, before anything parses the source (draw does). Each is in the
 * corpus; a source without them comes back byte for byte. On the way to
 * drawing only, like escapeAngles.
 *
 * - A mark on a line of its own: dropped (dropStrayMarks).
 * - A flowchart mark spaced off its shape, `D1{"x"} :::focus`: joined.
 * - A flowchart mark written inside its shape, `b{"x" :::focus}`: moved out
 *   after it. Inside, mermaid drew it as label text and the focus was lost.
 * - An erDiagram entity named like one of its keywords (`CLASS`, `style`,
 *   any case): quoted wherever it stands as an entity. Bare, the grammar
 *   read the keyword and refused the whole model.
 *
 * Text inside double quotes is a label and never touched.
 */
export function repair(src: string): string {
  const kind = diagramKind(src);
  if (kind === "erDiagram") return erKeywords(src);
  const out = dropStrayMarks(src);
  if (!out.includes(":::")) return out;
  if (kind !== "graph" && !kind.startsWith("flowchart")) return out;
  return out
    .split("\n")
    .map((l) =>
      outsideQuotes(l, (s) =>
        s
          // Inside: `{"x" :::focus}`, `([x :::focus])`, `[/x :::focus/]`. A
          // mark followed by a shape's closer is never valid anywhere else.
          .replace(/\s*(:::[A-Za-z][\w-]*)\s*([\])}]+|\/\]|\\\])/g, "$2$1")
          // Spaced: `{"x"} :::focus`.
          .replace(/([\])}])[ \t]+(:::[A-Za-z][\w-]*)/g, "$1$2"),
      ),
    )
    .join("\n");
}

/** outsideQuotes rewrites a line's text outside its double-quoted spans. */
function outsideQuotes(line: string, f: (s: string) => string): string {
  return line
    .split(/("[^"]*")/)
    .map((part, i) => (i % 2 === 1 ? part : f(part)))
    .join("");
}

/** The words erDiagram's grammar reads as its own, where an entity's name
 * can stand. */
const erWords = /^(class|classDef|style|direction|title|accTitle|accDescr)$/i;
const isErWord = (s: string) => erWords.test(s);
const erName = (s: string) => (isErWord(s) ? `"${s}"` : s);

const erEntity = "[A-Za-z_][\\w-]*";
/** A declaration: the name, an alias, and a block opened (and maybe closed)
 * on the line, or nothing more. */
const erDeclared = new RegExp(
  `^(\\s*)(${erEntity})(\\s*(?:\\[[^\\]]*\\])?\\s*(?:\\{.*)?)$`,
);
/** A relationship, spaced or not: `A ||--o{ B : label`. */
const erRelated = new RegExp(
  `^(\\s*)(${erEntity})(\\s*[|}o][|o]?(?:--|\\.\\.)[|o][|{o]?\\s*)(${erEntity})(\\s*:.*)$`,
);
/** A class statement: `class A,B name`. */
const erClassed = /^(\s*)class\s+(\S+)\s+([A-Za-z_][\w-]*)\s*;?\s*$/;

/** erKeywords quotes an entity named like a keyword wherever it stands as
 * one: either side of a relationship, a declaration with or without an
 * alias or a block. A class statement refuses it quoted or not, so it
 * leaves the statement and takes the class as a mark on its first
 * relationship (or declaration). A style statement takes it bare. */
function erKeywords(src: string): string {
  if (!src.split(/[^\w-]+/).some(isErWord)) return src;
  const marks = new Map<string, string>();
  let inBlock = false;
  const lines = src.split("\n").map((l) => {
    if (inBlock) {
      if (/^\s*}/.test(l)) inBlock = false;
      return l;
    }
    const rel = erRelated.exec(l);
    if (rel) return rel[1] + erName(rel[2]) + rel[3] + erName(rel[4]) + rel[5];
    const cls = erClassed.exec(l);
    if (cls) {
      const ids = cls[2].split(",");
      const kept = ids.filter((id) => !isErWord(id));
      if (kept.length === ids.length) return l;
      for (const id of ids) if (isErWord(id)) marks.set(id, cls[3]);
      return kept.length === 0
        ? null
        : `${cls[1]}class ${kept.join(",")} ${cls[3]}`;
    }
    const decl = erDeclared.exec(l);
    if (decl) {
      if (decl[3].includes("{") && !decl[3].includes("}")) inBlock = true;
      return decl[1] + erName(decl[2]) + decl[3];
    }
    return l;
  });
  const out = lines.filter((l): l is string => l !== null);
  for (const [id, mark] of marks) {
    const q = `"${id}"`;
    // Its first relationship, else its declaration.
    const related = out.findIndex((l) => l.includes(q) && /--|\.\./.test(l));
    const i =
      related >= 0
        ? related
        : out.findIndex((l) => l.trimStart().startsWith(q));
    if (i >= 0) out[i] = out[i].replace(q, `${q}:::${mark}`);
  }
  return out.join("\n");
}

export function escapeAngles(src: string): string {
  if (!/[<>]/.test(src)) return src;
  // Front matter is YAML, not diagram text: kept as written, the rest
  // escaped as a source of its own.
  const head = frontMatter(src).lines;
  if (head > 0) {
    const lines = src.split("\n");
    return [
      ...lines.slice(0, head),
      escapeAngles(lines.slice(head).join("\n")),
    ].join("\n");
  }
  const kind = diagramKind(src);
  const flow = kind === "graph" || kind.startsWith("flowchart");
  const text = flow ? quotedAcross(src) : src;
  let inNote = false;
  let inClass = false;
  return text
    .split("\n")
    .map((raw) => {
      const t = raw.trim();
      if (t.startsWith("%%")) return raw;
      if (flow) return flowchartLine(raw);
      const line = quotedIn(raw);
      if (kind === "sequenceDiagram") {
        const w = sequenceWords.exec(line);
        if (w) return w[1] + w[2] + entityAngles(w[3]);
        return afterColon(line);
      }
      if (kind.startsWith("stateDiagram")) {
        if (inNote) {
          if (/^end note\b/i.test(t)) {
            inNote = false;
            return line;
          }
          return entityAngles(line);
        }
        if (/^note\b/i.test(t) && !ownColon.test(t)) {
          inNote = true;
          return line;
        }
        return afterColon(line);
      }
      if (kind.startsWith("classDiagram")) {
        // A class body's members, `+List<Item> items`, are text whole.
        if (inClass) {
          if (t.startsWith("}")) {
            inClass = false;
            return line;
          }
          // A stereotype, `<<interface>>`, is syntax: escaped, it was read
          // as a member named by its text.
          if (/^<<[^<>]+>>$/.test(t)) return line;
          return entityAngles(line);
        }
        if (/^class\s+[^{]+\{\s*$/.test(t)) {
          inClass = true;
          return line;
        }
        return afterColon(line);
      }
      if (kind === "erDiagram") return afterColon(line);
      // A mindmap line is a node, its text whole; a mark or an icon on
      // the line after it is not text.
      if (kind === "mindmap")
        return /^:{2,3}/.test(t) ? line : entityAngles(line);
      // A timeline line is text whole: a title, a section, a period and its
      // events. No bracket in it is syntax.
      if (kind === "timeline") return entityAngles(line);
      return line;
    })
    .join("\n");
}
