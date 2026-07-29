#!/usr/bin/env node
/**
 * Vendor the F1 circuit layouts, and map them to what our schedule calls
 * each track.
 *
 *   node scripts/harvest-circuits.mjs
 *
 * The art is julesr0y/f1-circuits-svg (CC-BY-4.0), which covers every
 * circuit to have held a championship Grand Prix, with a layout per era.
 * Each file is one stroked path on a 500x500 canvas, no fill, which is why
 * it can be inlined and coloured by CSS instead of shipped as an image.
 * The <desc> in each file credits the author; keeping it is how the
 * attribution rides along with the thing it attributes.
 *
 * ONLY F1. Measured across a full 2026 season of all six racing leagues:
 * F1 carries a `circuit` object on every event, and IndyCar, all three
 * NASCAR series and NHRA carry NOTHING — no circuit, no venue, just an
 * event name ("Clash at Bowman Gray"). So there is no track to look art up
 * BY for those, generic oval or otherwise, and their cards go without.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard";
/**
 * The PLAIN style, not one of the -outline ones.
 *
 * Measured rather than assumed: white-outline is TWO paths, a 20px white
 * stroke with a 5px black one inside it, and both colours are literals. It
 * looks right on exactly one background. The plain style is a single path
 * with a single stroke, which is the thing that can be handed to CSS.
 */
const ART =
  "https://raw.githubusercontent.com/julesr0y/f1-circuits-svg/main/circuits/minimal/white";
const LIB =
  "https://raw.githubusercontent.com/julesr0y/f1-circuits-svg/main/circuits.json";
const OUT = new URL("../apps/app/src/features/sports/circuits/", import.meta.url);

/** The season to draw. A layout is chosen for the season being raced. */
const YEAR = new Date().getFullYear();

/**
 * Where the two sources disagree on a spelling badly enough that no amount
 * of normalising bridges it. One entry, and it is a genuine variant rather
 * than an accent: ESPN says Losail, the library says Lusail.
 */
const OVERRIDE = { 4211: "lusail" };

const get = async (url) =>
  (await run("curl", ["-sfL", "--max-time", "30", url], { maxBuffer: 1 << 26 })).stdout;

/**
 * Names, comparably.
 *
 * Diacritics go first and that is not cosmetic: ESPN writes "Autodromo
 * Jose Carlos Pace" and the library "Autódromo José Carlos Pace", so two
 * of the twenty-four hang on it. Then the words every circuit shares are
 * dropped, because "Circuit de Monaco" and "Monaco" are the same track and
 * the words doing the work are the ones left over.
 */
const norm = (s) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(circuit|autodromo|autodrome|international|nazionale|street|racing|course|park|grand prix|de|di|the|of|americas)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

/** Does a "2004-2009,2011-2025" run include this year? */
const covers = (seasons, year) =>
  seasons.split(",").some((r) => {
    const [from, to] = r.split("-").map(Number);
    return to ? year >= from && year <= to : year === from;
  });

/** The last season a layout was used, for choosing among stale ones. */
const newest = (seasons) =>
  Math.max(...seasons.split(",").flatMap((r) => r.split("-").map(Number)));

/**
 * Which layout to draw.
 *
 * The one raced this season, and otherwise the most RECENT one — not the
 * last in the array, which is a different thing and gets it wrong. Bahrain
 * lists bahrain-1 (2004-2009, 2011-2025), bahrain-2 (2010) and bahrain-3
 * (2020); the array's last entry is a one-off from six years ago and the
 * right answer is the first. Two circuits have no layout stamped for this
 * season, which means the library has not got to them rather than that the
 * track changed.
 */
const pickLayout = (circuit) =>
  circuit.layouts.find((l) => covers(l.seasons, YEAR)) ??
  circuit.layouts.reduce((a, b) => (newest(b.seasons) > newest(a.seasons) ? b : a));

const espn = JSON.parse(await get(`${ESPN}?dates=${YEAR}`));
const library = JSON.parse(await get(LIB));

const tracks = new Map();
for (const e of espn.events ?? []) {
  const c = e.circuit;
  if (c?.id && !tracks.has(c.id)) tracks.set(c.id, c);
}

await mkdir(OUT, { recursive: true });
const map = {};
const unmatched = [];
const stale = [];

for (const [id, c] of tracks) {
  const want = norm(c.fullName);
  const found =
    (OVERRIDE[id] && library.find((l) => l.id === OVERRIDE[id])) ||
    library.find((l) => norm(l.name) === want) ||
    library.find((l) => {
      const has = norm(l.name);
      return has && want && (has.includes(want) || want.includes(has));
    }) ||
    library.find((l) => norm(l.id) === want);
  if (!found) {
    unmatched.push(`${id} ${c.fullName}`);
    continue;
  }
  const layout = pickLayout(found);
  if (!covers(layout.seasons, YEAR)) stale.push(`${c.fullName} -> ${layout.layoutId} (${layout.seasons})`);
  // currentColor, so the card owns the colour and every theme pack gets
  // the right one for free. The file ships a literal white otherwise, and
  // a track that is white on every pack is a track drawn once and themed
  // never.
  const svg = (await get(`${ART}/${layout.layoutId}.svg`))
    .replace(/stroke:#fff/g, "stroke:currentColor")
    // A viewBox, WHICH THE FILES DO NOT HAVE. The library's README says
    // its SVGO config preserves one; the files ship width/height and no
    // viewBox at all. Without it the art has no intrinsic scale, so a box
    // told to be 100% wide crops the drawing at 500 user units instead of
    // fitting it — which looks like a broken asset and is a missing
    // attribute. The fixed width and height go with it, so the card sizes
    // this the way it sizes everything else.
    .replace(
      /<svg([^>]*?)\s+width="500"\s+height="500"/,
      '<svg$1 viewBox="0 0 500 500"',
    );
  await writeFile(new URL(`${layout.layoutId}.svg`, OUT), svg);
  map[id] = { layout: layout.layoutId, name: c.fullName, country: c.address?.country };
}

await writeFile(
  new URL("index.json", OUT),
  JSON.stringify({ year: YEAR, circuits: map }, null, 1) + "\n",
);

console.log(`${Object.keys(map).length} of ${tracks.size} circuits mapped and vendored`);
if (stale.length) console.log(`no ${YEAR} layout, using the most recent:\n  ${stale.join("\n  ")}`);
if (unmatched.length) console.log(`UNMATCHED:\n  ${unmatched.join("\n  ")}`);
