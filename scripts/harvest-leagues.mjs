#!/usr/bin/env node
/**
 * Build the Sports hub's league catalog, from ESPN, by asking it.
 *
 *   node scripts/harvest-leagues.mjs
 *
 * WHY A SHIPPED TABLE. ESPN does enumerate every sport and league it has,
 * but only on sports.core.api.espn.com, and code written against a host
 * nobody has been able to run against is code nobody has tested. The
 * scoreboard host answers for a single league and that is enough: a 200
 * proves the slug is real (an out-of-season league answers 200 with no
 * events), and the same response carries the league's own name, its
 * abbreviation and its marks.
 *
 * So every row in the generated table is one ESPN confirmed, and nothing in
 * it is typed by hand and hoped for. The candidate list below is the only
 * hand-written part, and a wrong guess there costs an omission rather than
 * a broken entry: it simply fails to verify and never reaches the file.
 *
 * Re-run it when leagues come and go. The output is committed, so the app
 * never waits on a network call to draw the picker.
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const OUT = new URL("../apps/app/src/features/sports/leagues.json", import.meta.url);

/** How many probes at once. Politeness, not a rate limit we have hit. */
const LANES = 8;

/**
 * What to call each of ESPN's sport paths.
 *
 * Its own words are inconsistent ("mma", "racing"), and these are the ones
 * a person browsing would look for. A sport that appears here and not in
 * the catalog costs nothing; one in the catalog and not here falls back to
 * its path, which is ugly rather than broken.
 */
const SPORTS = {
  soccer: "Soccer",
  football: "American Football",
  basketball: "Basketball",
  hockey: "Ice Hockey",
  baseball: "Baseball",
  tennis: "Tennis",
  racing: "Motorsport",
  rugby: "Rugby",
  cricket: "Cricket",
  golf: "Golf",
  mma: "Fighting",
  lacrosse: "Lacrosse",
  volleyball: "Volleyball",
  "water-polo": "Water Polo",
};

/** Every `sport/league` worth asking about. Verified, not assumed. */
const CANDIDATES = `
baseball/college-baseball baseball/college-softball baseball/mlb
baseball/world-baseball-classic
basketball/fiba basketball/mens-college-basketball basketball/nba
basketball/nba-development basketball/wnba basketball/womens-college-basketball
cricket/8039 cricket/8048
football/cfl football/college-football football/nfl football/ufl
golf/champions-tour golf/eur golf/liv golf/lpga golf/pga
hockey/hockey-world-cup hockey/mens-college-hockey hockey/nhl
hockey/womens-college-hockey
lacrosse/mens-college-lacrosse lacrosse/pll lacrosse/womens-college-lacrosse
mma/pfl mma/ufc
racing/f1 racing/irl racing/nascar-premier racing/nascar-secondary
racing/nascar-truck racing/nhra
rugby/180659 rugby/270559 rugby/289234
soccer/afc.asian.cup soccer/afc.champions soccer/afc.cup soccer/arg.1
soccer/aus.1 soccer/aut.1 soccer/bel.1 soccer/bol.1 soccer/bra.1
soccer/caf.champions soccer/caf.confed soccer/caf.nations soccer/chi.1
soccer/chn.1 soccer/club.friendly soccer/col.1 soccer/concacaf.champions
soccer/concacaf.champions_cup soccer/concacaf.gold
soccer/concacaf.leagues.cup soccer/concacaf.nations.league soccer/conmebol.america
soccer/conmebol.libertadores soccer/conmebol.sudamericana soccer/crc.1
soccer/cze.1 soccer/den.1 soccer/ecu.1 soccer/eng.1 soccer/eng.2 soccer/eng.3
soccer/eng.4 soccer/eng.charity soccer/eng.fa soccer/eng.league_cup
soccer/eng.w.1 soccer/esp.1 soccer/esp.2 soccer/esp.copa_del_rey
soccer/esp.super_cup soccer/fifa.confederations soccer/fifa.cwc
soccer/fifa.friendly soccer/fifa.friendly.w soccer/fifa.world
soccer/fifa.worldq.concacaf soccer/fifa.worldq.conmebol soccer/fifa.worldq.uefa
soccer/fifa.wwc soccer/fin.1 soccer/fra.1 soccer/fra.2
soccer/fra.coupe_de_france soccer/ger.1 soccer/ger.2 soccer/ger.dfb_pokal
soccer/gha.1 soccer/gre.1 soccer/gua.1 soccer/hon.1 soccer/idn.1 soccer/ind.1
soccer/irl.1 soccer/isr.1 soccer/ita.1 soccer/ita.2 soccer/ita.coppa_italia
soccer/jpn.1 soccer/ksa.1 soccer/mex.1 soccer/mex.copa_mx soccer/mys.1
soccer/ned.1 soccer/nga.1 soccer/nir.1 soccer/nor.1 soccer/par.1 soccer/per.1
soccer/por.1 soccer/rou.1 soccer/rsa.1 soccer/rus.1 soccer/sco.1 soccer/sgp.1
soccer/slv.1 soccer/sui.1 soccer/swe.1 soccer/tha.1 soccer/tur.1
soccer/uefa.champions soccer/uefa.champions_qual soccer/uefa.euro
soccer/uefa.euroq soccer/uefa.europa soccer/uefa.europa.conf
soccer/uefa.europa_qual soccer/uefa.nations soccer/uefa.super_cup
soccer/uefa.wchampions soccer/uefa.weuro soccer/uru.1 soccer/usa.1
soccer/usa.nwsl soccer/usa.open soccer/usa.usl.l1 soccer/ven.1 soccer/wal.1
tennis/atp tennis/wta
volleyball/mens-college-volleyball volleyball/womens-college-volleyball
water-polo/mens-college-water-polo
`
  .trim()
  .split(/\s+/);

async function probe(path) {
  let body;
  try {
    const { stdout } = await run("curl", ["-sf", "--max-time", "20", `${BASE}/${path}/scoreboard`], {
      maxBuffer: 1 << 26,
    });
    body = stdout;
  } catch {
    return null; // 404, or the network. Either way it does not ship.
  }
  let league;
  try {
    league = (JSON.parse(body).leagues ?? [])[0];
  } catch {
    return null;
  }
  if (!league?.name) return null;

  const logos = league.logos ?? [];
  const mark = logos.find((l) => (l.rel ?? []).includes("dark")) ?? logos[0];
  return {
    path,
    sport: path.split("/")[0],
    // The ABBREVIATION is the name a person uses ("Premier League", "NFL",
    // "Six Nations"). ESPN's `name` is the formal one and its `shortName`
    // is often the slug shouted back ("ENG.1", "180659").
    label: league.abbreviation ?? league.name,
    name: league.name,
    // https, because ESPN hands a couple of these back over http and the
    // webview will not load mixed content.
    logo: mark?.href?.replace(/^http:/, "https:"),
  };
}

const found = [];
for (let i = 0; i < CANDIDATES.length; i += LANES) {
  const lane = await Promise.all(CANDIDATES.slice(i, i + LANES).map(probe));
  found.push(...lane.filter(Boolean));
  process.stderr.write(`\r${found.length}/${Math.min(i + LANES, CANDIDATES.length)} verified`);
}
process.stderr.write("\n");

const sports = Object.entries(SPORTS)
  .map(([key, name]) => ({
    key,
    name,
    leagues: found
      .filter((l) => l.sport === key)
      .map(({ path, label, name, logo }) => ({ path, label, name, logo }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }))
  .filter((s) => s.leagues.length > 0)
  .sort((a, b) => b.leagues.length - a.leagues.length);

await writeFile(OUT, JSON.stringify({ sports }, null, 1) + "\n");
const missed = CANDIDATES.length - found.length;
console.log(
  `${found.length} leagues across ${sports.length} sports` +
    (missed ? `, ${missed} candidates did not verify` : "") +
    `\n-> ${OUT.pathname}`,
);
