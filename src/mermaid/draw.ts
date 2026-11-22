import type { Limits } from "../fits";
import type { Room } from "../render";
import { lie } from "../export";
import { diagramKind, frontMatter } from "./kind";
import { serial } from "./serial";
import { escapeAngles, repair } from "./text";
import { unsafeSource, unsafeSvg } from "./guard";

/**
 * One mermaid source drawn into an SVG string: the package's own drawing
 * for the kinds it covers (editorial.ts), the mermaid renderer's for the
 * rest. The caller sets the string as innerHTML.
 *
 * That is model output reaching innerHTML, and the reason it is allowed is
 * these guards. The own drawing writes every label through draw.ts's XML
 * escape: text only, never an attribute that loads. The renderer is gated
 * (guard.ts): a source naming anything that could make the browser fetch
 * (a URL, a url(), node data, a directive, a link, front matter beyond a
 * title ...) is not rendered, and a drawing that would load from outside is
 * not shown; either is an error, and the app shows the source as code. It
 * runs with `securityLevel: "strict"` and HTML labels off for every kind (a
 * flowchart's switch alone left a state or kanban label live markup).
 *
 * The renderer measures text with getBBox, which jsdom lacks, so a test
 * mocks `mermaid` and asserts on what this file does around it: parse,
 * cache, fall back. mermaid.parse alone runs under jsdom, and the corpus
 * test uses it to prove every corpus source is drawable.
 */

/** What a consumer sets once, before the first draw. */
export type DrawOptions = {
  /** Prefixes every drawing's element ids (`<ids>-<n>`): two drawings on
   * one page must not share one. The app's name. */
  ids?: string;
  /** The renderer's theme, read when it loads. Default: themeVariables(),
   * off the page's --color-* tokens. */
  themeVariables?: () => Record<string, string>;
  /** The own drawing's caps (../fits.ts); past them the renderer draws. */
  limits?: Partial<Limits>;
};

let options: Required<DrawOptions> = {
  ids: "diagram",
  themeVariables: () => themeVariables(),
  limits: {},
};

/** configure sets the options for every later draw. The renderer reads its
 * theme once, on load: call this before the first fence. */
export function configure(o: DrawOptions): void {
  options = { ...options, ...o };
}

/** The theme is read off the document, not tabulated here: the renderer
 * wants values in a config object, not classes on elements. Missing under
 * jsdom, where the tokens are not loaded; the renderer then keeps its own
 * defaults.
 *
 * Every frame is `--color-faint`, and that is a measurement, not a taste:
 * the border token is chrome, where it separates a panel from the page
 * ground, and against a node fill four points away from it a frame drew at
 * 1.3:1 and did not appear on screen at all. Faint reads at 4:1 and stays
 * under the arrows' muted, so the flow remains the loudest thing drawn. A
 * cluster sits on the page ground instead and reads 3.6:1 there; nothing
 * sits between the two, so it takes the same value rather than a quieter
 * rung that would draw nothing. A test asserts the five border keys, but
 * only the screen proves a line: a declared colour and the painted pixel
 * have disagreed before. */
export function themeVariables(): Record<string, string> {
  if (typeof getComputedStyle !== "function") return {};
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const vars: Record<string, string> = {};
  const set = (key: string, name: string) => {
    const v = token(name);
    if (v !== "") vars[key] = v;
  };
  set("background", "--color-bg");
  set("primaryColor", "--color-panel");
  set("primaryBorderColor", "--color-faint");
  set("primaryTextColor", "--color-ink");
  set("textColor", "--color-ink");
  set("lineColor", "--color-muted");
  set("signalColor", "--color-muted");
  set("signalTextColor", "--color-ink");
  set("secondaryColor", "--color-active");
  set("secondaryBorderColor", "--color-faint");
  set("secondaryTextColor", "--color-ink");
  // A note's colour: the page's ochre (rongo), else the drawing's warn role
  // and a wash of it (loom has no ochre: a note took the renderer's yellow).
  const ochre = token("--color-ochre") || token("--diagram-warn");
  const ochreWash = token("--color-ochre-wash") || washOf(ochre);
  for (const [key, v] of [
    ["tertiaryColor", ochreWash],
    ["tertiaryBorderColor", ochre],
    ["noteBkgColor", ochreWash],
    ["noteBorderColor", ochre],
  ])
    if (v !== "") vars[key] = v;
  set("tertiaryTextColor", "--color-ink");
  set("noteTextColor", "--color-ink");
  set("actorBkg", "--color-active");
  set("actorBorder", "--color-faint");
  set("actorTextColor", "--color-ink");
  set("actorLineColor", "--color-faint");
  set("labelBoxBkgColor", "--color-panel");
  set("labelBoxBorderColor", "--color-faint");
  set("labelTextColor", "--color-ink");
  set("loopTextColor", "--color-ink");
  set("edgeLabelBackground", "--color-panel");
  set("clusterBkg", "--color-bg");
  set("clusterBorder", "--color-faint");
  set("titleColor", "--color-ink");
  set("attributeBackgroundColorOdd", "--color-panel");
  set("attributeBackgroundColorEven", "--color-active");
  set("fontFamily", "--font-sans");
  // The renderer's own default is 16px, which is prose size; a label is
  // chrome and reads at the size the rest of the chrome does.
  vars.fontSize = "13.5px";
  return vars;
}

/** washOf is a colour at rongo's ochre-wash strength (0.14), for a page
 * that names only the colour. A hex or rgb() value; anything else (a name,
 * color-mix(), which the renderer cannot read either) gives no wash. */
function washOf(color: string): string {
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const h =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  if (fn) rgb = [fn[1], fn[2], fn[3]].map(Number);
  return rgb ? `rgba(${rgb.join(", ")}, 0.14)` : "";
}

/** The renderer is loaded on the first fence, not with the page: it is the
 * largest dependency by far, and a page that draws no diagram should not
 * carry it. One import promise, so two fences arriving together load it
 * once. */
type Mermaid = typeof import("mermaid").default;
let loading: Promise<Mermaid> | null = null;
function renderer(): Promise<Mermaid> {
  if (!loading) {
    loading = import("mermaid").then(
      (m) => {
        init(m.default);
        return m.default;
      },
      (e: unknown) => {
        // A load that failed (a redeploy took the chunk away, a blip) is
        // tried again by the next fence, not remembered for the session.
        loading = null;
        throw e;
      },
    );
  }
  return loading;
}

function init(mermaid: Mermaid): void {
  mermaid.initialize(
    mermaidConfig(options.themeVariables(), mermaid.mermaidAPI?.defaultConfig),
  );
}

/** The keys a source may never set, whatever its kind's section: the
 * renderer drops each from a directive or front matter, at any depth. The
 * gate refuses both already; this holds if it ever does not. */
const locked = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "maxEdges",
  "suppressErrorRendering",
  "dompurifyConfig",
  "htmlLabels",
  "themeCSS",
  "themeVariables",
  "fontFamily",
  "altFontFamily",
];
/** Every key of the renderer's own config whose value ends up as CSS, a
 * font, a colour or a URL (a C4 element's font, ticketBaseUrl ...), read
 * off its defaults so a key a mermaid bump adds is locked too. */
const risky =
  /css|font|colou?r|fill|stroke|style|url|icon|theme|html|secur|dompurify/i;

/** mermaidConfig is the renderer's whole configuration, the theme's
 * variables in it, every risky key of defaults locked. Exported for the
 * tests, which render with it. */
export function mermaidConfig(
  vars: Record<string, string>,
  defaults: unknown = {},
): Parameters<Mermaid["initialize"]>[0] {
  const secure = new Set(locked);
  const walk = (o: unknown) => {
    if (o === null || typeof o !== "object" || Array.isArray(o)) return;
    for (const [k, v] of Object.entries(o)) {
      if (risky.test(k)) secure.add(k);
      if (k !== "themeVariables") walk(v);
    }
  };
  walk(defaults);
  return {
    secure: [...secure],
    startOnLoad: false,
    securityLevel: "strict",
    // Every kind, not only flowcharts: an HTML label is live markup, and a
    // styled span in one fetched its url().
    htmlLabels: false,
    theme: "base",
    // The renderer's default look ("neo") puts a drop shadow under every
    // box; the chrome has none, so the drawing has none either.
    look: "classic",
    themeVariables: vars,
    fontFamily: vars.fontFamily,
    flowchart: { htmlLabels: false, curve: "basis" },
    sequence: { useMaxWidth: true },
    er: { useMaxWidth: true },
  };
}

/** A drawing, and whose: `own` is the package's (editorial.ts), drawn at
 * its natural width on a canvas of its own; otherwise the renderer's,
 * scaled into the card. */
export type Drawn = { svg: string; own?: true } | { error: string };

/** The kinds the package draws itself; every other kind is the
 * renderer's. */
export const ownKinds: ReadonlySet<string> = new Set([
  "flowchart",
  "graph",
  "sequenceDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "mindmap",
  "timeline",
  "quadrantChart",
  "classDiagram",
  "classDiagram-v2",
]);

/** ours is the package's drawing of a parsed source, or null where it has
 * none. Anything going wrong in it (the chunk gone after a redeploy, a
 * layout that throws) is a reason to let the renderer draw, never a failed
 * picture. */
async function ours(
  mermaid: Mermaid,
  src: string,
  room: Room,
): Promise<string | null> {
  // Asked by kind before anything loads: a pie or a gantt chart never
  // fetches the layout engine or parses its source a second time.
  if (!ownKinds.has(diagramKind(src))) return null;
  try {
    const { editorial } = await import("./editorial");
    return await editorial(
      mermaid,
      src,
      `${options.ids}-${++seq}`,
      options.limits,
      room,
    );
  } catch {
    return null;
  }
}

/** One drawing per source text, however many times the answer re-renders.
 * A stream re-renders on every token, and a closed fence is drawn once.
 * Never evicted: a session's diagrams are a few strings, and the same
 * string mounted twice (the card and the full view) is one drawing. */
const drawn = new Map<string, Promise<Drawn>>();
/** The drawings done, by the same keys: drawnNow reads them without a
 * tick. */
const done = new Map<string, Drawn>();
let seq = 0;

/** The kinds whose drawing depends on the room it is shown in: a timeline
 * lies flat where it fits and stands up elsewhere. */
const roomKinds: ReadonlySet<string> = new Set(["timeline"]);
/** The width each such source lies flat at, learnt from its first own
 * drawing. */
const flatAt = new Map<string, number>();
/** The sources of such a kind whose drawing turned out the same in any
 * room: the renderer's, which has no way to lie. */
const roomFree = new Set<string>();

/** keyOf is a drawing's place in the cache: its source, and for a drawing
 * that depends on its room, which way the room lays it. Never the width
 * alone once that is known: a card resized by a pixel would draw again.
 * Standing is the drawing without a width, so both share the source's
 * key. */
function keyOf(src: string, width: number | undefined): string {
  if (width === undefined || !roomKinds.has(diagramKind(src))) return src;
  if (roomFree.has(src)) return src;
  const wide = flatAt.get(src);
  if (wide === undefined) return `${src}\n%% width ${width}`;
  return width >= wide ? `${src}\n%% flat` : src;
}

/** draw renders a source to an SVG string, or to the parser's complaint.
 *
 * Only a drawing is kept. The renderer loads each diagram type as its own
 * chunk, so the first sequence or entity diagram of a session can fail for
 * a reason that is not the source (a redeploy took the hashed chunk away, a
 * network blip); kept, that failure would follow the source for the rest
 * of the session. A refused source is cheap to refuse again.
 *
 * The source is drawn with its angle brackets kept as text (escapeAngles,
 * text.ts). Should that ever fail to parse where the source as written
 * does, the source as written is drawn: keeping a bracket must never cost a
 * picture that drew without it, and a refusal quotes what the model wrote,
 * not the escaped text.
 *
 * room is where the drawing is shown: a timeline's way depends on its
 * width (../render.ts Room). A width of 0 is one not measured yet. */
export function draw(src: string, room: Room = {}): Promise<Drawn> {
  const width =
    room.width !== undefined && room.width > 0 ? room.width : undefined;
  const key = keyOf(src, width);
  let p = drawn.get(key);
  if (!p) {
    p = (async (): Promise<Drawn> => {
      try {
        const mermaid = await renderer();
        // The shapes models write that the renderer refuses (a class mark
        // on a line of its own, one spaced off or inside its shape, an
        // entity named like a keyword) are mended before anything reads it.
        const written = repair(src);
        const text = escapeAngles(written);
        if (text !== written) {
          try {
            return learn(src, await drawFrom(mermaid, text, { width }));
          } catch (e) {
            // Only a refusal of the escaped text falls back. Anything else (a
            // chunk gone after a redeploy, a blip) is no reason to cache a
            // picture without its brackets for the session; it fails this
            // attempt like any other, and the next one tries again.
            if (await mermaid.parse(text, { suppressErrors: true })) throw e;
            // A form escapeAngles escapes into something the renderer
            // refuses: drawn below as written, its brackets lost as before.
            // Said, so the gap shows.
            console.warn(
              "diagram: escaped source refused, drawn as written",
              e,
            );
          }
        }
        return learn(src, await drawFrom(mermaid, written, { width }));
      } catch (e) {
        drawn.delete(key);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    })();
    drawn.set(key, p);
    // A first drawing at a width is the drawing for its whole side of the
    // flat width, which it has just told: filed under that side as well.
    const first = p;
    void first.then((d) => {
      if (!("svg" in d)) return;
      done.set(key, d);
      const side = keyOf(src, width);
      if (side !== key && !drawn.has(side)) {
        drawn.set(side, first);
        done.set(side, d);
      }
    });
  }
  return p;
}

/** drawnNow is the drawing draw(src, room) has finished, or null while
 * there is none: a refusal, one on its way, one never asked for. A card
 * mounting again reads it in its first render and shows the picture at
 * once, rather than a placeholder for the tick a promise takes. */
export function drawnNow(src: string, room: Room = {}): Drawn | null {
  const width =
    room.width !== undefined && room.width > 0 ? room.width : undefined;
  return done.get(keyOf(src, width)) ?? null;
}

/** learn keeps the width a drawing says it lies flat at, for keyOf, or that
 * it says none: the renderer's timeline (one past the caps) is the same in
 * every room, and each new width cost a full render. */
function learn(src: string, d: Drawn): Drawn {
  if (!("svg" in d)) return d;
  const l = lie(d.svg);
  if (l !== null) flatAt.set(src, l.wide);
  else roomFree.add(src);
  return d;
}

/** drawFrom is one attempt at a drawing. The own one first: its parse is
 * the only one a flowchart pays for. A source it cannot parse is declined
 * like any other and meets the renderer's parse, which says why. */
async function drawFrom(
  mermaid: Mermaid,
  text: string,
  room: Room,
): Promise<Drawn> {
  const own = await ours(mermaid, text, room);
  if (own !== null) return { svg: own, own: true };
  // Gated, before and after: a source that could make the browser fetch is
  // never rendered, a drawing that would is never shown (guard.ts). Thrown,
  // like any refusal: draw keeps drawings only, and the app shows the
  // source as code.
  const before = unsafeSource(text);
  if (before !== null) throw new Error(`unsafe: ${before}`);
  // In the chain the package's read is in: the renderer's db is one for the
  // page (serial.ts).
  const id = `${options.ids}-${++seq}`;
  const { svg } = await serial(async () => {
    await mermaid.parse(text);
    return mermaid.render(id, text);
  });
  const after = unsafeSvg(svg);
  if (after !== null) throw new Error(`unsafe: ${after}`);
  return { svg };
}

/** English names of the pictures by type, the default for diagramTitle. */
export const titles: Readonly<Record<string, string>> = {
  flowchart: "Flow diagram",
  graph: "Flow diagram",
  sequenceDiagram: "Sequence diagram",
  stateDiagram: "State diagram",
  "stateDiagram-v2": "State diagram",
  erDiagram: "Entity diagram",
  mindmap: "Mind map",
  classDiagram: "Class diagram",
  timeline: "Timeline",
  quadrantChart: "Quadrant chart",
  "classDiagram-v2": "Class diagram",
};

/** diagramTitle names the picture, in the accessible label, the file and
 * the full view's header: the front matter's own `title:`, else its kind's
 * name. names is the app's own (its language); a kind it lacks is
 * `fallback`. */
export function diagramTitle(
  src: string,
  names: Readonly<Record<string, string>> = titles,
  fallback = "Diagram",
): string {
  return frontMatter(src).title || (names[diagramKind(src)] ?? fallback);
}
