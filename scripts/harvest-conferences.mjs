#!/usr/bin/env node
/**
 * Build the Sports hub's conference table, from ESPN, by asking it.
 *
 *   node scripts/harvest-conferences.mjs
 *
 * WHY A SHIPPED TABLE, when the board could read the names off the games it
 * already has. ESPN names a conference on `competitions[].groups`, and it
 * only does so when BOTH sides share one. So a day of cross-conference
 * fixtures names nothing, and college football's first two weekends are
 * exactly that: the filter would open with no chips in it on the two
 * Saturdays anyone most wants to narrow.
 *
 * Sweeping a season fixes that, because every conference plays conference
 * games at some point in it. The sweep runs here, once, and the answer is
 * committed.
 *
 * WHAT IT CANNOT LEARN, and the reason `EXTRA` exists below: an independent
 * has no conference games by definition, so ESPN never names its group and
 * this sweep can never see it. Notre Dame is the case that matters. Those
 * rows are written by hand, against ids the sweep DID observe on
 * `team.conferenceId`, and the script says so when it finds one it cannot
 * name on its own.
 *
 * The ids are LEAGUE-SCOPED and the collision is real rather than
 * theoretical: college football's ACC is 1, college basketball's is 2. The
 * output is keyed by league path for that reason.
 *
 * Re-run it when conferences realign, which in college sport is roughly
 * every other year.
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const OUT = new URL(
  "../apps/app/src/features/sports/conferences.json",
  import.meta.url,
);

/** How many days at once. Politeness, not a rate limit we have hit. */
const LANES = 6;

/**
 * WHICH DAYS TO SWEEP, per league, and why they are dates rather than a
 * range: ESPN silently caps a range response at 100 events, so a season
 * asked for in one go drops most of itself without saying so. Per-day asks
 * cannot hit that cap. (The same trap is documented in useGames.)
 *
 * College football is Saturdays, because that is where the conference
 * games are. Basketball is a handful of midweek and weekend dates in
 * January and February, when conference play is all there is.
 *
 * `groups` is the DIVISION filter, not a conference one: 80 is FBS and 50
 * is Division I basketball. Basketball needs it. Measured 2026-09-06, the
 * bare scoreboard returned 21 events for a day that carries 145.
 */
const SWEEPS = [
  {
    path: "football/college-football",
    groups: "80",
    dates: [
      "20250906", "20250913", "20250920", "20250927",
      "20251004", "20251011", "20251018", "20251025",
      "20251101", "20251108", "20251115", "20251122", "20251129",
    ],
  },
  {
    path: "basketball/mens-college-basketball",
    groups: "50",
    dates: [
      "20260103", "20260110", "20260114", "20260117", "20260121",
      "20260124", "20260128", "20260131", "20260207", "20260214",
      "20260218", "20260221", "20260228",
    ],
  },
  {
    path: "basketball/womens-college-basketball",
    groups: "50",
    dates: [
      "20260103", "20260110", "20260114", "20260117", "20260121",
      "20260124", "20260128", "20260131", "20260207", "20260214",
      "20260218", "20260221", "20260228",
    ],
  },
];

/**
 * The conferences no sweep can name, because their members never play a
 * conference game. Ids confirmed against `team.conferenceId` in the sweep
 * itself, so these are observed rather than guessed; only the WORDS are
 * hand-written.
 */
const EXTRA = {
  "football/college-football": {
    18: { name: "FBS Independents", shortName: "Independents" },
  },
};

async function day(path, groups, date) {
  let body;
  try {
    const { stdout } = await run(
      "curl",
      [
        "-sf",
        "--max-time",
        "30",
        `${BASE}/${path}/scoreboard?dates=${date}&groups=${groups}`,
      ],
      { maxBuffer: 1 << 26 },
    );
    body = stdout;
  } catch {
    return null; // A dead date, or the network. Neither is worth failing on.
  }
  try {
    return JSON.parse(body).events ?? [];
  } catch {
    return null;
  }
}

const out = {};
let asked = 0;
let failed = 0;

for (const { path, groups, dates } of SWEEPS) {
  /** id -> { name, shortName }, and the ids seen on teams but never named. */
  const named = new Map();
  const seen = new Set();

  for (let i = 0; i < dates.length; i += LANES) {
    const lane = await Promise.all(
      dates.slice(i, i + LANES).map((d) => day(path, groups, d)),
    );
    asked += lane.length;
    for (const events of lane) {
      if (!events) {
        failed++;
        continue;
      }
      for (const event of events) {
        const comp = (event.competitions ?? [])[0];
        if (!comp) continue;
        const g = comp.groups;
        if (g?.id && g.isConference && g.name) {
          named.set(String(g.id), {
            name: g.name,
            // ESPN's own short form ("Big Ten", "CUSA"). The long one is
            // "Big Ten Conference", which no chip has room for.
            shortName: g.shortName ?? g.name,
          });
        }
        for (const c of comp.competitors ?? []) {
          const id = c.team?.conferenceId;
          if (id) seen.add(String(id));
        }
      }
    }
    process.stderr.write(`\r${path}: ${named.size} named`);
  }
  process.stderr.write("\n");

  for (const [id, row] of Object.entries(EXTRA[path] ?? {})) {
    if (!named.has(id)) named.set(id, row);
  }

  // Ids that turned up on a team and that nothing could name. Reported
  // rather than invented: an unnamed conference is one the picker cannot
  // offer, which is the correct outcome, but a NEW one appearing here means
  // EXTRA needs a row.
  const unnamed = [...seen].filter((id) => !named.has(id));
  if (unnamed.length > 0) {
    console.warn(
      `  ${path}: ${unnamed.length} conference ids seen but not named ` +
        `(${unnamed.sort((a, b) => Number(a) - Number(b)).join(", ")})`,
    );
  }

  out[path] = Object.fromEntries(
    [...named.entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
  );
}

await writeFile(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(
  Object.entries(out)
    .map(([path, rows]) => `${Object.keys(rows).length} in ${path}`)
    .join(", ") +
    (failed ? `, ${failed} of ${asked} days did not answer` : "") +
    `\n-> ${OUT.pathname}`,
);
