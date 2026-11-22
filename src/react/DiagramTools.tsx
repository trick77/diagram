import type { ReactNode } from "react";
import {
  classes as defaultClasses,
  strings as defaultStrings,
  type Classes,
  type Icons,
  type Strings,
} from "./types";

/** DiagramTools is a diagram's two ways out: the full view and the file.
 * The card draws it; a page with its own frame for a drawing (almanach's
 * compact map) uses the row alone. `over` sets it over a frame's top right
 * corner instead of in a row above the drawing. */
export function DiagramTools({
  title,
  onFull,
  onSave,
  icons,
  strings = defaultStrings,
  classes = defaultClasses,
  over = false,
}: {
  /** The picture's name, in the buttons' accessible names. */
  title: string;
  onFull: () => void;
  onSave: () => void;
  icons: Icons;
  strings?: Strings;
  classes?: Classes;
  over?: boolean;
}): ReactNode {
  return (
    <div className={over ? classes.over : classes.tools}>
      <button
        type="button"
        onClick={onFull}
        title={strings.full}
        aria-label={strings.fullOf(title)}
        className={classes.button}
      >
        {icons.expand}
      </button>
      <button
        type="button"
        onClick={onSave}
        title={strings.download}
        aria-label={strings.downloadOf(title)}
        className={classes.button}
      >
        {icons.download}
      </button>
    </div>
  );
}
