import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { DiagramCard, type Redraw, type ShellProps } from "./index";

/** A shell with nothing of its own but the dialog. */
function Shell({ label, header, children }: ShellProps) {
  return (
    <div role="dialog" aria-label={label}>
      {header}
      {children}
    </div>
  );
}
const icons = { expand: <i />, download: <i /> };

// A timeline drawn either way, flat at 900px and wider.
const flat =
  '<svg data-orient="horizontal" data-wide="900"><g id="flat"/></svg>';
const standing =
  '<svg data-orient="vertical" data-wide="900"><g id="standing"/></svg>';
const redraw = vi.fn(async (w: number) => (w >= 900 ? flat : standing));

// jsdom lays nothing out: the card's room is set here, and the observer
// is a stand-in the test fires by hand.
let width = 0;
let observed: (() => void)[] = [];
beforeEach(() => {
  redraw.mockClear();
  observed = [];
  width = 0;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => width,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: () => void) {}
      observe() {
        observed.push(this.cb);
      }
      disconnect() {
        observed = observed.filter((c) => c !== this.cb);
      }
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (svg: string, r: Redraw = redraw) =>
  render(
    <DiagramCard
      svg={svg}
      title="Timeline"
      fileName="app-timeline.svg"
      shell={Shell}
      icons={icons}
      redraw={r}
    />,
  );
const resize = (w: number) =>
  act(() => {
    width = w;
    for (const cb of observed) cb();
  });

describe("a card in its room", () => {
  it("lays a timeline flat when the text it sits in has room", async () => {
    width = 1000;
    const { container } = card(standing);
    await waitFor(() =>
      expect(container.querySelector("#flat")).not.toBeNull(),
    );
    expect(redraw).toHaveBeenCalledWith(1000);
  });

  it("never shows the drawing made for the wrong room first", async () => {
    width = 1000;
    let answer: (s: string) => void = () => {};
    const slow = vi.fn(
      () => new Promise<string | null>((r) => (answer = (s) => r(s))),
    );
    const { container } = card(standing, slow);
    // Measured before the first paint: the standing one is never put up.
    expect(slow).toHaveBeenCalledWith(1000);
    expect(container.querySelector("svg")).toBeNull();
    await act(async () => answer(flat));
    expect(container.querySelector("#flat")).not.toBeNull();
    expect(container.querySelector("#standing")).toBeNull();
  });

  it("shows the drawing at once when it is already the right way", () => {
    width = 700;
    const { container } = card(standing);
    expect(container.querySelector("#standing")).not.toBeNull();
  });

  it("asks again only when the room crosses the flat width", async () => {
    width = 700;
    const { container } = card(standing);
    expect(redraw).not.toHaveBeenCalled();
    resize(880);
    expect(redraw).not.toHaveBeenCalled();
    resize(950);
    await waitFor(() =>
      expect(container.querySelector("#flat")).not.toBeNull(),
    );
    resize(1200);
    expect(redraw).toHaveBeenCalledTimes(1);
    resize(600);
    await waitFor(() =>
      expect(container.querySelector("#standing")).not.toBeNull(),
    );
    expect(redraw.mock.calls.map((c) => c[0])).toEqual([950, 600]);
  });

  it("keeps watching through a new redraw on every render", async () => {
    width = 700;
    const props = {
      svg: standing,
      title: "Timeline",
      fileName: "x.svg",
      shell: Shell,
      icons,
    };
    const made = vi.spyOn(globalThis, "ResizeObserver");
    const { rerender, container } = render(
      <DiagramCard {...props} redraw={(w) => redraw(w)} />,
    );
    rerender(<DiagramCard {...props} redraw={(w) => redraw(w)} />);
    rerender(<DiagramCard {...props} redraw={(w) => redraw(w)} />);
    expect(made).toHaveBeenCalledTimes(1);
    resize(1000);
    await waitFor(() =>
      expect(container.querySelector("#flat")).not.toBeNull(),
    );
  });

  it("leaves a drawing alone that looks the same at any width", () => {
    width = 1000;
    card('<svg width="300"><g id="flow"/></svg>');
    resize(400);
    expect(redraw).not.toHaveBeenCalled();
  });

  it("leaves it as it came before the room is measured, or without redraw", () => {
    card(standing);
    expect(redraw).not.toHaveBeenCalled();
    width = 1000;
    const { container } = render(
      <DiagramCard
        svg={standing}
        title="Timeline"
        fileName="x.svg"
        shell={Shell}
        icons={icons}
      />,
    );
    expect(container.querySelector("#standing")).not.toBeNull();
  });

  it("keeps the drawing shown when a redraw fails", async () => {
    width = 1000;
    const failing = vi.fn(async () => {
      throw new Error("chunk gone");
    });
    const { container } = card(standing, failing);
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(container.querySelector("#standing")).not.toBeNull();
  });

  it("lays it flat in the full view when the window has room", async () => {
    width = 500;
    vi.stubGlobal("innerWidth", 1400);
    const { container, getByRole, getAllByRole } = card(standing);
    expect(container.querySelector("#flat")).toBeNull();
    fireEvent.click(getAllByRole("button")[0]);
    const dialog = getByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("#flat")).not.toBeNull());
    // The card itself stays standing in its narrow column.
    expect(container.querySelector(":scope > div #standing")).not.toBeNull();
    vi.stubGlobal("innerWidth", 700);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() =>
      expect(dialog.querySelector("#standing")).not.toBeNull(),
    );
  });
});
