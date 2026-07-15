// Generates the Dither theme's background: a REAL ordered (Bayer) dither of
// a #000 -> #1F1F1F diagonal gradient, as a vector SVG asset.
//
// How it works (the classic 4x4 Bayer construction, per the refs Adam sent —
// tympanus.net/Tutorials/BayerDithering, github.com/tsbehlman/bayer-dithering):
// the 4x4 threshold matrix orders the 16 cells of a tile; a brightness level
// k in [0..16] lights exactly the cells whose threshold < k. Sweeping k along
// the gradient axis produces the signature stepped crosshatch bands.
//
// Geometry: the dither PIXELS stay screen-axis-aligned (patterns defined in
// root user space) while the LEVEL BANDS run diagonally — each band is a
// full-viewport rect filled with its level's pattern, clipped by a rotated
// band clipPath. Band edges cut some cells mid-pixel; at this contrast the
// sliver is invisible, and it keeps the file tiny vs per-cell rects.
//
// Deterministic: same input -> same file. Output is committed; rerun only to
// retune. Usage: node scripts/gen-bayer-svg.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const W = 1920;
const H = 1080;
const CELL = 6; // dither pixel, in viewBox units (~6px at 1080p cover)
const TILE = CELL * 4;
const DARK = "#000000";
const LIT = "#1f1f1f";
const ANGLE = 38; // band axis rotation (deg) — the mock's ~128deg CSS sweep

// The canonical 4x4 Bayer threshold matrix.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const LEVELS = 16; // bands 1..16 (level 0 is the bare dark base)

// Pattern defs: level k lights cells with threshold < k.
let defs = "";
for (let k = 1; k <= LEVELS; k++) {
  let cells = "";
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (BAYER[y][x] < k) {
        cells += `<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}"/>`;
      }
    }
  }
  defs += `<pattern id="l${k}" width="${TILE}" height="${TILE}" patternUnits="userSpaceOnUse"><g fill="${LIT}">${cells}</g></pattern>`;
}

// Band clip rects: laid along a rotated axis through the viewport centre,
// long enough to cover the corners at any rotation (the diagonal).
const DIAG = Math.ceil(Math.hypot(W, H)); // 2203
const SPAN = DIAG + TILE * 2;
const bandW = SPAN / (LEVELS + 1); // 17 slots: base + 16 lit levels
const cx = W / 2;
const cy = H / 2;
for (let k = 1; k <= LEVELS; k++) {
  // Band k starts where level k begins; the LAST band extends to the end so
  // the brightest corner is fully lit rather than falling back to base.
  const x0 = -SPAN / 2 + bandW * k;
  const w = k === LEVELS ? SPAN - bandW * k : bandW;
  defs += `<clipPath id="c${k}"><rect x="${(cx + x0).toFixed(1)}" y="${cy - SPAN / 2}" width="${w.toFixed(1)}" height="${SPAN}" transform="rotate(${ANGLE} ${cx} ${cy})"/></clipPath>`;
}

let body = `<rect width="${W}" height="${H}" fill="${DARK}"/>`;
for (let k = 1; k <= LEVELS; k++) {
  body += `<rect width="${W}" height="${H}" fill="url(#l${k})" clip-path="url(#c${k})"/>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;

const out = new URL("../apps/app/src/assets/dither-bayer.svg", import.meta.url)
  .pathname;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB)`);
