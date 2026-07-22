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
const CELL = 2; // dither pixel, in viewBox units (~2px at 1080p cover)
const TILE = CELL * 4;
const DARK = "#000000";
const LIT = "#1f1f1f";

// Blob field (v3): instead of one linear sweep, the luminance comes from a
// handful of soft radial blobs. Each blob's level-k region is a shrinking
// concentric ellipse (luminance falls off linearly with distance), and
// because Bayer levels are NESTED (level k's lit cells contain level j's for
// k > j), overlapping blobs union into exactly max(level) — no field math
// needed. Hand-placed for composition; deterministic.
const BLOBS = [
  // big hotspot, upper right (the mock's bright corner)
  { cx: 1660, cy: 140, rx: 760, ry: 620, rot: -24, level: 16 },
  // broad glow, lower left
  { cx: 240, cy: 960, rx: 640, ry: 520, rot: 18, level: 12 },
  // quiet mid-left haze
  { cx: 620, cy: 380, rx: 470, ry: 360, rot: -12, level: 7 },
  // lower-right shoulder
  { cx: 1420, cy: 920, rx: 420, ry: 330, rot: 30, level: 9 },
  // small top-center accent
  { cx: 980, cy: 170, rx: 280, ry: 220, rot: 8, level: 6 },
];

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

// Blob contour clips: each blob's luminance falls off linearly from its
// centre, so its level-k iso-region is a concentric ellipse shrunk by
// (1 - (k-1)/level). One clipPath + one pattern-filled rect per (blob, k);
// nested Bayer levels make overlaps compose to max(level) for free.
let body = `<rect width="${W}" height="${H}" fill="${DARK}"/>`;
BLOBS.forEach((b, i) => {
  for (let k = 1; k <= b.level; k++) {
    const f = 1 - (k - 1) / b.level;
    const rx = (b.rx * f).toFixed(1);
    const ry = (b.ry * f).toFixed(1);
    const id = `b${i}k${k}`;
    defs += `<clipPath id="${id}"><ellipse cx="${b.cx}" cy="${b.cy}" rx="${rx}" ry="${ry}" transform="rotate(${b.rot} ${b.cx} ${b.cy})"/></clipPath>`;
    body += `<rect width="${W}" height="${H}" fill="url(#l${Math.min(k, LEVELS)})" clip-path="url(#${id})"/>`;
  }
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;

const out = new URL("../apps/app/src/assets/dither-bayer.svg", import.meta.url)
  .pathname;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB)`);
