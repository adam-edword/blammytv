/**
 * Lagoon's lit page (plan 035, round 2): the Stream hero's art, read for four
 * colours and written to the root as `--page-ambient`, the radial lights
 * packs.css paints behind the whole page. Without it the page wears the
 * canvas's own teal and amber (packs.css), which is also what it wears on the
 * screens that have no hero.
 *
 * Only Stream has art to read: Home and the film and series tabs are all
 * StreamScreen's one hero (HeroAmbient). The Guide, Live, Sports and Library
 * keep the stylesheet's lights.
 *
 * The existing ambient (stream.css `.shero__ambient`) blurs the art onto a
 * canvas it never reads back, and could not: that image is loaded without
 * CORS, which taints the canvas. So this loads the picture again with
 * `crossOrigin`, small, and only while Lagoon is showing, so no other theme
 * pays for a second request. A host that sends no CORS header just leaves the
 * stylesheet's lights on, with nothing thrown.
 */

const GRID = 6;
/** Where each light sits and how strong (packs.css's, in the same order),
 * and the part of the picture it takes its colour from: [x0, x1, y0, y1] in
 * cells of the GRID x GRID sample. */
const LIGHTS = [
  { at: "50% 22% at 20% 6%", alpha: 0.26, from: [0, 3, 0, 2] },
  { at: "40% 16% at 85% 36%", alpha: 0.14, from: [3, 6, 2, 4] },
  { at: "55% 18% at 30% 62%", alpha: 0.18, from: [0, 3, 2, 4] },
  { at: "50% 16% at 80% 92%", alpha: 0.1, from: [3, 6, 4, 6] },
] as const;

let seq = 0;

/** Whether Lagoon is showing: chosen, and dark. */
export function lagoonShowing(): boolean {
  const d = document.documentElement.dataset;
  return d.themePack === "lagoon" && d.theme !== "light";
}

/** The lights for a GRID x GRID sample of RGBA bytes. */
export function ambientFrom(px: Uint8ClampedArray | number[]): string {
  return LIGHTS.map(({ at, alpha, from: [x0, x1, y0, y1] }) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * GRID + x) * 4;
        r += px[i];
        g += px[i + 1];
        b += px[i + 2];
        n++;
      }
    return `radial-gradient(${at}, rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)} / ${alpha}), transparent 70%)`;
  }).join(", ");
}

/** Put the lights of `src` on the root. A newer call, or clearPageAmbient,
 * drops an older one still loading. */
export function publishPageAmbient(src: string | null): void {
  const mine = ++seq;
  if (!src) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (mine !== seq) return;
    try {
      const c = document.createElement("canvas");
      c.width = c.height = GRID;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0, GRID, GRID);
      document.documentElement.style.setProperty("--page-ambient", ambientFrom(g.getImageData(0, 0, GRID, GRID).data));
    } catch {
      /* a canvas the host's picture tainted: keep the stylesheet's lights */
    }
  };
  img.src = src;
}

/** Back to the stylesheet's lights. */
export function clearPageAmbient(): void {
  seq++;
  document.documentElement.style.removeProperty("--page-ambient");
}
