import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  DiagramCard,
  DiagramTools,
  DiagramView,
  classes,
  strings,
  type ShellProps,
} from "./index";

/** A shell as an app's would be, without its keyboard: those are the app's
 * and tested there. */
function Shell({
  label,
  dialogClassName,
  headerClassName,
  header,
  onClose,
  children,
}: ShellProps) {
  return (
    <div data-testid="scrim">
      <div role="dialog" aria-label={label} className={dialogClassName}>
        <header className={headerClassName}>
          {header}
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const icons = {
  expand: <i data-icon="expand" />,
  download: <i data-icon="download" />,
};

const svg =
  '<svg viewBox="0 0 300 120" width="900"><g class="drawn"></g></svg>';

/** saved catches the download: its file name, and the file's text. */
function saving(): { name: string; blob: Blob | null; done: () => void } {
  const out = { name: "", blob: null as Blob | null, done: () => {} };
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (b: Blob) => {
      out.blob = b;
      return "blob:x";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => {},
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      out.name = this.download;
    });
  out.done = () => click.mockRestore();
  return out;
}

afterEach(() => {
  document.head.querySelectorAll("style[data-test]").forEach((s) => s.remove());
});

function card(props: Partial<Parameters<typeof DiagramCard>[0]> = {}) {
  return render(
    <DiagramCard
      svg={svg}
      title="Sequence diagram"
      fileName="app-sequence-diagram.svg"
      shell={Shell}
      icons={icons}
      {...props}
    />,
  );
}

describe("DiagramCard", () => {
  // ./mermaid draw marks only the own drawing (own: true); the renderer's
  // comes without the key, and `own={drawn.own}` must give it the frame.
  it("is the renderer's framed card unless told own", () => {
    const { container } = card({ own: undefined });
    expect(container.querySelector(".bg-panel")).not.toBeNull();
    expect(container.querySelector(".w-max")).toBeNull();
  });

  it("fits its own drawing to the text rather than scrolling it", () => {
    const { container } = card({ own: true });
    expect(container.querySelector(".diagram-svg svg .drawn")).not.toBeNull();
    expect(container.querySelector(".overflow-x-auto")).toBeNull();
    // No ground of its own: the drawing brings its canvas.
    expect(container.querySelector(".bg-panel")).toBeNull();
  });

  it("never runs wider than the text it sits in", () => {
    const { getByLabelText } = card({ own: true });
    const c = getByLabelText(/full view/).closest(".w-max") as HTMLElement;
    expect(c.className).toContain("max-w-full");
  });

  it("frames a drawing the renderer made, its buttons over the frame's corner", () => {
    const { container, getByLabelText } = card({ own: false });
    const frame = container.querySelector(".bg-panel") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.className).toContain("relative");
    const row = getByLabelText("Sequence diagram: full view").parentElement!;
    expect(row.parentElement).toBe(frame);
    expect(row.className).toContain("absolute");
    expect(row.className).toContain("from-panel");
    expect(getByLabelText("Sequence diagram: download SVG").parentElement).toBe(
      row,
    );
  });

  it("offers the full view and the file above its own drawing, never over it", () => {
    const { getByLabelText } = card({ own: true });
    const full = getByLabelText("Sequence diagram: full view");
    expect(getByLabelText("Sequence diagram: download SVG")).toBeTruthy();
    expect(full.getAttribute("title")).toBe("Full view");
    const row = full.parentElement!;
    expect(row.className).not.toContain("absolute");
    expect(
      row.nextElementSibling?.querySelector(".diagram-svg"),
    ).not.toBeNull();
    expect(full.querySelector('[data-icon="expand"]')).not.toBeNull();
  });

  it("speaks the app's language", () => {
    const { getByLabelText } = card({
      title: "Sequenzdiagramm",
      strings: {
        ...strings,
        full: "Vollansicht",
        fullOf: (t) => `${t}: Vollansicht`,
      },
    });
    expect(
      getByLabelText("Sequenzdiagramm: Vollansicht").getAttribute("title"),
    ).toBe("Vollansicht");
  });

  it("opens the full view on the button and closes it again", () => {
    const { getByLabelText, queryByRole } = card();
    expect(queryByRole("dialog")).toBeNull();
    fireEvent.click(getByLabelText("Sequence diagram: full view"));
    expect(queryByRole("dialog")?.getAttribute("aria-label")).toBe(
      "Sequence diagram",
    );
    expect(queryByRole("dialog")?.querySelector("svg .drawn")).toBeTruthy();
    fireEvent.click(getByLabelText("Close"));
    expect(queryByRole("dialog")).toBeNull();
  });

  it("downloads the drawing under its name, on the card's ground", async () => {
    const style = document.createElement("style");
    style.setAttribute("data-test", "1");
    style.textContent = ".ground { background-color: #1b1b1a; }";
    document.head.appendChild(style);
    const s = saving();
    const { getByLabelText } = render(
      <div className="ground">
        <DiagramCard
          svg={svg}
          title="State diagram"
          fileName="app-state-diagram.svg"
          shell={Shell}
          icons={icons}
        />
      </div>,
    );
    fireEvent.click(getByLabelText("State diagram: download SVG"));
    expect(s.name).toBe("app-state-diagram.svg");
    expect(await s.blob!.text()).toContain('fill="rgb(27, 27, 26)"');
    s.done();
  });

  it("lays the overlay over the drawing, in the card and the full view", () => {
    const overlay = vi.fn(({ full, close }) => (
      <a href="#n" onClick={close}>
        {full ? "in full" : "inline"}
      </a>
    ));
    const { getByText, getByLabelText, queryByRole } = card({
      own: true,
      overlay,
    });
    expect(getByText("inline").parentElement?.className).toBe("relative");
    fireEvent.click(getByLabelText("Sequence diagram: full view"));
    expect(queryByRole("dialog")?.textContent).toContain("in full");
    // A link followed from the full view closes it.
    fireEvent.click(getByText("in full"));
    expect(queryByRole("dialog")).toBeNull();
  });
});

// The row alone: almanach's compact map has its buttons without a card.
describe("DiagramTools", () => {
  it("is the two buttons, named for the picture, in the row's classes", () => {
    const onFull = vi.fn();
    const onSave = vi.fn();
    const { getByLabelText } = render(
      <DiagramTools
        title="Map"
        onFull={onFull}
        onSave={onSave}
        icons={icons}
        classes={{ ...classes, tools: "my-row" }}
      />,
    );
    const full = getByLabelText("Map: full view");
    expect(full.parentElement?.className).toBe("my-row");
    fireEvent.click(full);
    expect(onFull).toHaveBeenCalled();
    fireEvent.click(getByLabelText("Map: download SVG"));
    expect(onSave).toHaveBeenCalled();
    expect(full.getAttribute("title")).toBe(strings.full);
  });

  it("sits over a frame's corner when asked to", () => {
    const { getByLabelText } = render(
      <DiagramTools
        title="Map"
        onFull={() => {}}
        onSave={() => {}}
        icons={icons}
        over
      />,
    );
    expect(getByLabelText("Map: full view").parentElement?.className).toBe(
      classes.over,
    );
  });

  it("leaves the card's spacing to the app", () => {
    const { container } = card({ classes: { ...classes, card: "my-6" } });
    expect((container.firstElementChild as HTMLElement).className).toBe("my-6");
    const { container: plain } = card();
    expect((plain.firstElementChild as HTMLElement).className).toBe("mt-3");
  });

  it("is the row the card draws", () => {
    const { getByLabelText } = card({
      own: true,
      classes: { ...classes, tools: "card-row" },
    });
    expect(getByLabelText(/full view/).parentElement?.className).toBe(
      "card-row",
    );
  });
});

// jsdom lays nothing out: the scrim's room and the sheet's chrome (its
// header, 60px) are stood in for, the shell's padding and the body's being
// none here.
describe("DiagramView fitting its drawing", () => {
  const restore: (() => void)[] = [];
  function stub(prop: string, of: (el: HTMLElement) => number) {
    // Shadowed on HTMLElement, wherever jsdom defines it (client* sit on
    // Element, offset* on HTMLElement), and put back after.
    const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return of(this);
      },
    });
    restore.push(() => {
      if (was) Object.defineProperty(HTMLElement.prototype, prop, was);
      else
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          prop
        ];
    });
  }
  const isBody = (el: HTMLElement) =>
    el.parentElement?.getAttribute("role") === "dialog" && el.tagName === "DIV";
  function room(w: number, h: number) {
    stub("clientWidth", (el) => (el.dataset.testid === "scrim" ? w : 0));
    stub("clientHeight", (el) => (el.dataset.testid === "scrim" ? h : 0));
    stub("offsetWidth", (el) =>
      el.getAttribute("role") === "dialog" || isBody(el) ? w : 0,
    );
    stub("offsetHeight", (el) =>
      el.getAttribute("role") === "dialog" ? h : isBody(el) ? h - 60 : 0,
    );
  }
  afterEach(() => {
    while (restore.length) restore.pop()!();
  });

  function shown(drawing: string) {
    const { container } = render(
      <DiagramView
        svg={drawing}
        title="Flow"
        fileName="app-flow-diagram.svg"
        onClose={() => {}}
        shell={Shell}
        icons={icons}
      />,
    );
    return container.querySelector('[role="dialog"] .diagram-svg')!
      .parentElement as HTMLElement;
  }

  // 1150×783 in a 761px body scrolled ~70px: it shrinks to the height too.
  it("shrinks a drawing too tall for the sheet until it fits both ways", () => {
    room(1200, 821);
    const wrapper = shown(
      '<svg width="1150" height="783" viewBox="0 0 1150 783"></svg>',
    );
    // 761 / 783 of 1150.
    expect(parseFloat(wrapper.style.width)).toBeCloseTo((1150 * 761) / 783, 0);
  });

  it("shrinks a wide one to the width, and never grows a small one", () => {
    room(800, 900);
    expect(
      parseFloat(
        shown('<svg width="1600" height="200" viewBox="0 0 1600 200"></svg>')
          .style.width,
      ),
    ).toBe(800);
    expect(
      shown('<svg width="300" height="120" viewBox="0 0 300 120"></svg>').style
        .width,
    ).toBe("300px");
  });

  it("leaves the drawing to its classes where there is no room to measure", () => {
    expect(
      shown('<svg width="300" height="120" viewBox="0 0 300 120"></svg>').style
        .width,
    ).toBe("");
  });
});

describe("DiagramView", () => {
  function view(onClose: () => void = () => {}) {
    return render(
      <DiagramView
        svg={svg}
        title="Sequence diagram"
        fileName="app-sequence-diagram.svg"
        onClose={onClose}
        shell={Shell}
        icons={icons}
      />,
    );
  }

  it("names the picture in its header", () => {
    const { getByRole } = view();
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Sequence diagram");
    expect(dialog.querySelector("header")?.textContent).toContain(
      "Sequence diagram",
    );
    expect(dialog.querySelector("svg .drawn")).toBeTruthy();
  });

  it("sizes the sheet to the drawing, a phone's to the screen", () => {
    const { getByRole } = view();
    const sheet = getByRole("dialog").className;
    expect(sheet).toContain("sm:w-fit");
    expect(sheet).toContain("sm:max-w-full");
    expect(sheet).toContain("h-full w-full");
  });

  // jsdom lays nothing out, so the constraint is asserted as classes. An
  // implicit grid column grows to its content: the wrapper's max-w-full then
  // caps nothing, and a 1578px drawing scrolled sideways in a 1198px body.
  // One explicit column is the body's width, which the wrapper is held to.
  it("scales a wide drawing into the body rather than scrolling it", () => {
    const { getByRole } = view();
    const wrapper = getByRole("dialog").querySelector(".diagram-svg")!
      .parentElement as HTMLElement;
    const body = wrapper.parentElement as HTMLElement;
    expect(body.className).toMatch(/\bgrid\b/);
    expect(body.className).toContain("grid-cols-1");
    expect(wrapper.className).toContain("max-w-full");
  });

  it("draws its chrome in the sans face, not the page's serif prose", () => {
    const { getByRole } = view();
    expect(getByRole("dialog").className).toContain("font-sans");
  });

  it("closes through its shell", () => {
    const onClose = vi.fn();
    const { getByLabelText } = view(onClose);
    fireEvent.click(getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("downloads the picture it is showing", () => {
    const s = saving();
    const { getByText } = view();
    fireEvent.click(getByText("Download SVG"));
    expect(s.name).toBe("app-sequence-diagram.svg");
    expect(s.blob).not.toBeNull();
    s.done();
  });
});
