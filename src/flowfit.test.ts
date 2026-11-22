import { describe, expect, it, vi } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";

// check as it is, but a test can make one call report a problem: a spine or
// an org chart check refuses is not found in the corpus.
const forced = vi.hoisted(() => ({ next: false }));
vi.mock("./check/check", async (original) => {
  const real = await original<typeof import("./check/check")>();
  return {
    ...real,
    check: (...args: Parameters<typeof real.check>) => {
      if (forced.next) {
        forced.next = false;
        return ["forced"];
      }
      return real.check(...args);
    },
  };
});

import { layoutFlowChecked } from "./flowfit";
import { layoutFlow, layoutSpine } from "./layout";
import { check } from "./check/check";
import type { FlowEdgeIR, FlowIR } from "./ir";

const e = (from: string, to: string, label = ""): FlowEdgeIR => ({
  from,
  to,
  label,
  dashed: false,
  head: "end",
});
const flow = (
  nodes: [string, string, "step" | "decision"][],
  edges: FlowEdgeIR[],
): FlowIR => ({
  kind: "flow",
  direction: "TB",
  nodes: nodes.map(([id, label, shape]) => ({ id, label, shape })),
  edges,
  zones: [],
});

// Two branches merging into one end node, the other branch beside them. In
// the order written the engine crossed h->i over g->j and c->j.
const merge = flow(
  [
    ["a", "Loan due date passes", "step"],
    ["b", "Returned?", "decision"],
    ["c", "Close the loan", "step"],
    ["d", "Add overdue fee", "step"],
    ["e", "Send a reminder", "step"],
    ["f", "Fee settled?", "decision"],
    ["g", "Loan cleared", "step"],
    ["h", "Block the card", "step"],
    ["i", "Refer to collections", "step"],
    ["j", "Archive the record", "step"],
  ],
  [
    e("a", "b"),
    e("b", "c", "Yes"),
    e("b", "d", "No"),
    e("d", "e"),
    e("e", "f"),
    e("f", "g", "Yes"),
    e("f", "h", "No"),
    e("h", "i"),
    e("g", "j"),
    e("c", "j"),
  ],
);

/** counted is the engine, counting how often it is asked for. */
function counted() {
  const asked = { n: 0 };
  return { asked, elk: async () => (asked.n++, new ELK()) };
}

describe("layoutFlowChecked", () => {
  it("lays a flow the written order crosses out again, free of the order", async () => {
    expect(check(await layoutFlow(merge, async () => new ELK()))).not.toEqual(
      [],
    );
    expect(
      check(await layoutFlowChecked(merge, async () => new ELK())),
    ).toEqual([]);
  });

  // A branch that rejoins: no spine, no tree, the engine's from the start.
  it("keeps the engine's written order where it draws clean", async () => {
    const rejoin = flow(
      [
        ["a", "Start", "step"],
        ["b", "Ok?", "decision"],
        ["c", "Fix", "step"],
        ["d", "Ship", "step"],
        ["x", "Done", "step"],
      ],
      [
        e("a", "b"),
        e("b", "c", "no"),
        e("b", "d", "yes"),
        e("c", "x"),
        e("d", "x"),
      ],
    );
    const { asked, elk } = counted();
    const first = await layoutFlow(rejoin, elk);
    expect(layoutSpine(rejoin)).toBeNull();
    expect(first.bus).toBeUndefined();
    expect(asked.n).toBe(1);
    expect(check(first)).toEqual([]);
    expect(await layoutFlowChecked(rejoin, elk)).toEqual(first);
    // Clean the first time: no second layout.
    expect(asked.n).toBe(2);
  });

  // The retry left the spine and the org chart where they were: only the
  // engine read `free`. Refused, they are laid out by the engine, free.
  it("hands a spine or an org chart the rules refuse to the engine", async () => {
    const chain = flow(
      [
        ["a", "One", "step"],
        ["b", "Two", "step"],
        ["c", "Three", "step"],
      ],
      [e("a", "b"), e("b", "c")],
    );
    expect(layoutSpine(chain)).not.toBeNull();
    const { asked, elk } = counted();
    forced.next = true;
    const l = await layoutFlowChecked(chain, elk);
    expect(asked.n).toBe(1);
    expect(l).not.toEqual(layoutSpine(chain));

    const org = flow(
      ["r", "a", "b", "c", "a1", "a2", "b1", "b2"].map(
        (id) => [id, id, "step"] as [string, string, "step"],
      ),
      [
        e("r", "a"),
        e("r", "b"),
        e("r", "c"),
        e("a", "a1"),
        e("a", "a2"),
        e("b", "b1"),
        e("b", "b2"),
      ],
    );
    expect((await layoutFlow(org, elk)).bus).toBe(true);
    forced.next = true;
    expect((await layoutFlowChecked(org, elk)).bus).toBeUndefined();
  });
});
