import { beforeAll, describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { toIR } from "./ir";
import { escapeAngles } from "./text";
import { diagramTitle, ownKinds } from "./draw";
import type { MindNodeIR, MindmapIR } from "../ir";

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
});

async function mindmap(src: string): Promise<MindmapIR> {
  const d = await mermaid.mermaidAPI.getDiagramFromText(src);
  const out = toIR(d.type, d.db);
  expect(out).not.toBeNull();
  expect(out!.kind).toBe("mindmap");
  return out as MindmapIR;
}

/** outline is a tree as indented lines, focus marked with a star. */
const outline = (n: MindNodeIR, depth = 0): string[] => [
  `${"  ".repeat(depth)}${n.label}${n.focus ? " *" : ""}`,
  ...n.children.flatMap((c) => outline(c, depth + 1)),
];

describe("toIR for a mindmap", () => {
  // The form loom's prompt asks for: an id and a quoted label, so a label's
  // own brackets are text, never a shape.
  it('reads id["…"] labels and a root(("…")) as their text alone', async () => {
    const m = await mindmap(`mindmap
  root(("Garden plan (spring)"))
    beds["Raised beds"]
      soil["Soil: compost (40 %)"]
    crops["Crops"]
    :::focus`);
    expect(outline(m.root)).toEqual([
      "Garden plan (spring)",
      "  Raised beds",
      "    Soil: compost (40 %)",
      "  Crops *",
    ]);
  });

  it("reads the tree in the order written, whatever shape a node is in", async () => {
    const m = await mindmap(`mindmap
  root((Project kickoff))
    [Budget]
      Costs 12 %
      (Größe & Umfang)
    Team setup
      Roles
        Lead
        Review`);
    expect(outline(m.root)).toEqual([
      "Project kickoff",
      "  Budget",
      "    Costs 12 %",
      "    Größe & Umfang",
      "  Team setup",
      "    Roles",
      "      Lead",
      "      Review",
    ]);
  });

  it("takes :::focus on the line after a node as that node's mark", async () => {
    const m = await mindmap(`mindmap
  Plan
    Scope
    :::focus
      Goals
    Risks
      Delays
      :::focus urgent`);
    expect(outline(m.root)).toEqual([
      "Plan",
      "  Scope *",
      "    Goals",
      "  Risks",
      "    Delays *",
    ]);
  });

  it("draws an icon as nothing and a markdown label as its plain text", async () => {
    const m = await mindmap(`mindmap
  Plan
    Notes
      ::icon(fa fa-book)
    \`**Ship** it\``);
    expect(outline(m.root)).toEqual(["Plan", "  Notes", "  Ship it"]);
  });

  it("keeps angle brackets in a label as text, never a mark or an icon's", async () => {
    const src = `mindmap
  root((Limits <draft>))
    Errors < 1 %
    :::focus
      Map<K, V>
        ::icon(fa fa-<x>)
    [Keep <b>bold</b>]`;
    const escaped = escapeAngles(src);
    expect(escaped.split("\n")[3]).toBe("    :::focus");
    expect(escaped.split("\n")[5]).toBe("        ::icon(fa fa-<x>)");
    const m = await mindmap(escaped);
    expect(outline(m.root)).toEqual([
      "Limits <draft>",
      "  Errors < 1 % *",
      "    Map<K, V>",
      "  Keep bold",
    ]);
  });

  it("is a kind the package draws, named a mind map", () => {
    expect(ownKinds.has("mindmap")).toBe(true);
    expect(diagramTitle("mindmap\n  root")).toBe("Mind map");
  });

  it("declines a db it cannot read", () => {
    expect(toIR("mindmap", {})).toBeNull();
    expect(toIR("mindmap", { getMindmap: () => null })).toBeNull();
    expect(toIR("mindmap", { getMindmap: () => ({ descr: "" }) })).toBeNull();
    // A node without children is a node with none.
    expect(toIR("mindmap", { getMindmap: () => ({ descr: "Plan" }) })).toEqual({
      kind: "mindmap",
      root: { label: "Plan", children: [] },
    });
  });
});
