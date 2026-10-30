import type { ReactElement } from "react";
import type { HomeRowKind } from "./layout";

/**
 * A small picture of what a Home row looks like on Home, for Settings → Home
 * (Adam, 1.0.40: glyphs over full-width pictures, which made a long list
 * twice as tall to drag through). Flat shapes in the text colour at a low
 * mix, so they read in every theme and in Light. Saved and Trakt rows are
 * poster rows on Home, so they share the catalog's picture.
 */

const W = 52;
const H = 28;
const STRONG = "color-mix(in srgb, var(--text) 34%, transparent)";
const SOFT = "color-mix(in srgb, var(--text) 18%, transparent)";
const LINE = "color-mix(in srgb, var(--text) 62%, transparent)";
const PROGRESS = [0.7, 0.35, 0.85];

type Shape = ReactElement;
const rr = (x: number, y: number, w: number, h: number, r: number, fill: string, k: string): Shape => (
  <rect key={k} x={x} y={y} width={w} height={h} rx={r} fill={fill} />
);
const dot = (cx: number, cy: number, r: number, fill: string, k: string): Shape => (
  <circle key={k} cx={cx} cy={cy} r={r} fill={fill} />
);

/** As many of one card as fit across, the last one cut by the edge. */
function across(w: number, gap: number, draw: (x: number, i: number) => Shape[]): Shape[] {
  const out: Shape[] = [];
  for (let i = 0, x = 0; x < W; i++, x += w + gap) out.push(...draw(x, i));
  return out;
}

function shapesFor(kind: HomeRowKind): Shape[] {
  switch (kind) {
    case "carousel": {
      const hw = H * 1.2;
      const side = (W - hw) / 2 - 2;
      return [
        rr(0, 4, side, H - 8, 2, SOFT, "l"),
        rr(W - side, 4, side, H - 8, 2, SOFT, "r"),
        rr((W - hw) / 2, 0, hw, H, 3, STRONG, "hero"),
        rr((W - hw) / 2 + 3, H * 0.62, hw * 0.36, 2.6, 1.3, LINE, "t1"),
        rr((W - hw) / 2 + 3, H * 0.78, hw * 0.22, 2, 1, SOFT, "t2"),
      ];
    }
    case "continue": {
      const h = H * 0.8;
      const w = (h * 16) / 9;
      return across(w, 3, (x, i) => [
        rr(x, 0, w, h, 2.5, STRONG, `c${i}`),
        rr(x, h + 2, w, 2.4, 1.2, SOFT, `t${i}`),
        rr(x, h + 2, w * PROGRESS[i % 3], 2.4, 1.2, LINE, `p${i}`),
      ]);
    }
    case "upnext": {
      const h = H * 0.74;
      const w = (h * 16) / 9;
      return across(w, 3, (x, i) => [
        rr(x, 0, w, h, 2.5, STRONG, `c${i}`),
        rr(x, h + 2.4, w * 0.6, 2.6, 1.3, LINE, `a${i}`),
        rr(x + w * 0.64, h + 2.4, w * 0.22, 2.6, 1.3, SOFT, `b${i}`),
      ]);
    }
    case "catalog":
    case "saved":
    case "trakt": {
      const w = (H * 2) / 3;
      return across(w, 3, (x, i) => [rr(x, 0, w, H, 2.5, STRONG, `p${i}`)]);
    }
    case "onnow":
    case "recent": {
      const on = kind === "onnow";
      const h = on ? H * 0.74 : H * 0.86;
      const w = (h * 16) / 9;
      return across(w, 3, (x, i) => [
        rr(x, 0, w, h, 2.5, STRONG, `c${i}`),
        dot(x + w / 2, h / 2, h * 0.2, LINE, `l${i}`),
        ...(on
          ? [
              rr(x, h + 2.8, w, 2.4, 1.2, SOFT, `t${i}`),
              rr(x, h + 2.8, w * PROGRESS[(i + 1) % 3], 2.4, 1.2, LINE, `p${i}`),
            ]
          : []),
      ]);
    }
    case "games": {
      const w = H * 1.9;
      return across(w, 3, (x, i) => [
        rr(x, 0, w, H, 3, STRONG, `c${i}`),
        dot(x + w * 0.22, H * 0.42, H * 0.17, LINE, `a${i}`),
        dot(x + w * 0.78, H * 0.42, H * 0.17, LINE, `b${i}`),
        rr(x + w * 0.42, H * 0.36, w * 0.16, H * 0.12, 1.5, SOFT, `s${i}`),
        rr(x + w * 0.36, H * 0.72, w * 0.28, 2.4, 1.2, SOFT, `t${i}`),
      ]);
    }
    case "recordings": {
      const h = H * 0.7;
      const w = (h * 16) / 9;
      return across(w, 3, (x, i) => [
        rr(x, 0, w, h, 2.5, STRONG, `c${i}`),
        dot(x + h * 0.2, h * 0.2, h * 0.09, "var(--danger)", `r${i}`),
        rr(x, h + 2.2, w * 0.7, 2.4, 1.2, LINE, `a${i}`),
        rr(x, h + 5.8, w * 0.45, 2.2, 1.1, SOFT, `b${i}`),
      ]);
    }
    case "needs":
      return [
        <rect key="box" x={0.75} y={0.75} width={W - 1.5} height={H - 1.5} rx={3.4} fill="none" stroke={STRONG} strokeWidth={1.5} strokeDasharray="4 2.8" />,
        rr(W / 2 - 5.6, H / 2 - 0.9, 11.2, 1.8, 0.9, STRONG, "h"),
        rr(W / 2 - 0.9, H / 2 - 5.6, 1.8, 11.2, 0.9, STRONG, "v"),
      ];
  }
}

export function RowGlyph({ kind }: { kind: HomeRowKind }) {
  return (
    <span className="homerows__glyph" data-glyph={kind} aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} overflow="hidden">
        {shapesFor(kind)}
      </svg>
    </span>
  );
}
