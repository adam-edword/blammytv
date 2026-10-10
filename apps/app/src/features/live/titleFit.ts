/**
 * Does a programme title run past its cell? Answered from the title's text,
 * the cell's width and the font, with no read from the DOM.
 *
 * It used to ask the DOM: after every render the Guide read `scrollWidth`
 * and `clientWidth` of every title on screen. Each read lands inside a
 * `content-visibility: auto` cell, and a cell the browser is skipping has to
 * be laid out for the answer, one forced update per cell. At 4 hours that was
 * about 75 cells; the same pass over a day's worth of cells (about 435 on the
 * 8,516 channel rig) put 80ms of style and layout in every row step, and
 * grew with the cells, not with what a viewer could see (measured 2026-10-10).
 *
 * The browser's own answer is `scrollWidth > clientWidth + 1`. The text's
 * width comes from a canvas, in the font the title is drawn in, and the
 * room is the cell less the border and padding it spends before the text.
 */

/** What the canvas needs to measure a title the way the page draws it. All
 * of it is read once from the CSS (`probeTitleFont`), not assumed: the font
 * is a design token a theme may re-point. */
export interface TitleFont {
  font: string;
  letterSpacing: string;
  wordSpacing: string;
  kerning: string;
  rendering: string;
  /** The cell's horizontal border and padding: what it spends before the
   * title gets any room (2px of border, 28px of padding). */
  chrome: number;
}

/** A title as the page lays it out: `white-space: nowrap` collapses runs of
 * whitespace and drops the ends. */
export function titleText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** The same test the DOM answer used (`scrollWidth > clientWidth + 1`), on
 * widths the browser snaps to whole pixels. `room` is the cell's width less
 * its chrome. */
export function clipsTitle(textWidth: number, room: number): boolean {
  return Math.round(textWidth) > Math.round(Math.max(0, room)) + 1;
}

/**
 * Read what the canvas needs from the CSS itself: a programme cell with a
 * title in it, built from the same classes, put in the page for the length
 * of the read and taken out again. Style only, so it forces no layout.
 *
 * It is a probe and not a title that is on screen because the first
 * programmes are drawn the moment they arrive, and a title can only be read
 * once drawn. Reading from one meant drawing every title unfaded, reading
 * the font, and drawing them all again.
 */
export function probeTitleFont(): TitleFont | null {
  const make = (tag: string, cls: string) => {
    const el = document.createElement(tag);
    el.className = cls;
    return el;
  };
  const cell = make("div", "guide__cell");
  const shine = make("span", "guide__cell-shine");
  const body = make("span", "guide__cell-body");
  const title = make("span", "guide__cell-title");
  title.textContent = "M";
  body.append(title);
  shine.append(body);
  cell.append(shine);
  cell.style.visibility = "hidden";
  cell.style.pointerEvents = "none";
  document.body.append(cell);
  try {
    const t = getComputedStyle(title);
    const c = getComputedStyle(cell);
    const s = getComputedStyle(shine);
    const px = (v: string) => parseFloat(v) || 0;
    return {
      font: `${t.fontStyle} ${t.fontWeight} ${t.fontSize} ${t.fontFamily}`,
      letterSpacing: t.letterSpacing,
      wordSpacing: t.wordSpacing,
      kerning: t.fontKerning,
      rendering: t.textRendering,
      chrome:
        px(c.borderLeftWidth) +
        px(c.borderRightWidth) +
        px(s.paddingLeft) +
        px(s.paddingRight),
    };
  } finally {
    cell.remove();
  }
}

/** How many font faces have finished loading. A face that lands after a
 * title was measured changes the answer; this is how the Guide notices
 * without re-measuring on every font event. */
export function loadedFaceCount(): number {
  let n = 0;
  document.fonts?.forEach((f) => {
    if (f.status === "loaded") n++;
  });
  return n;
}

/** Widths are cached per title text. A day of schedule on a big provider is
 * hundreds of thousands of titles and only the ones a viewer scrolls past
 * are measured, but the cache still has an end. */
const MAX_CACHED = 20_000;

export function createTitleMeter() {
  let spec: TitleFont | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let broken = false;
  let faces = 0;
  const widths = new Map<string, number>();

  const canvas = () => {
    if (!ctx && !broken) {
      ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) broken = true;
    }
    return ctx;
  };

  return {
    /** True once there is a font to measure in. Until then nothing is
     * faded: a title is never faded on a guess. */
    ready: () => spec !== null,
    /** True when there is no canvas to measure with; the Guide stops asking. */
    unavailable: () => broken,
    chrome: () => spec?.chrome ?? 30,
    /** Face count when the cache was last emptied. */
    faces: () => faces,
    setFont(next: TitleFont): boolean {
      const c = canvas();
      if (!c) return false;
      c.font = next.font;
      c.letterSpacing = next.letterSpacing;
      c.wordSpacing = next.wordSpacing;
      c.fontKerning = next.kerning as CanvasFontKerning;
      c.textRendering = next.rendering as CanvasTextRendering;
      spec = next;
      widths.clear();
      faces = loadedFaceCount();
      return true;
    },
    /** Forget every width (a face has landed); the font itself stands. */
    invalidate() {
      widths.clear();
      faces = loadedFaceCount();
    },
    /** A title's natural width. Callers check `ready()` first. */
    width(raw: string): number {
      const text = titleText(raw);
      let w = widths.get(text);
      if (w === undefined) {
        if (widths.size >= MAX_CACHED) widths.clear();
        w = ctx?.measureText(text).width ?? 0;
        widths.set(text, w);
      }
      return w;
    },
  };
}

export type TitleMeter = ReturnType<typeof createTitleMeter>;
