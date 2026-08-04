import React from "react";
import ReactDOM from "react-dom/client";
import "../src/fonts";
import "../src/styles/tokens.css";
import "../src/styles/packs.css";
import "../src/styles/base.css";
import "../src/styles/ui.css";
import "../src/styles/themes.css";
import "../src/styles/live.css";
import "../src/styles/stream.css";
import "../src/styles/sports.css";
import "../src/styles/discover.css";
import { SportsTheater } from "../src/features/sports/SportsTheater";
import { toGames } from "../src/features/sports/espn";
import { isFixture } from "../src/features/sports/model";
import { indexChannels } from "../src/features/sports/matcher";
import type { Tunable } from "../src/features/sports/matcher";
import { applyAccent, loadAccent } from "../src/features/settings/accent";
import { applyTheme, loadTheme } from "../src/features/settings/theme";
import channels from "../src/features/sports/fixtures/channels.json";
import mlb from "./fixtures/mlb.json";
import nba from "./fixtures/nba.json";
import nhl from "./fixtures/nhl.json";
import epl from "./fixtures/epl.json";

/**
 * Layout rig for the theater, the half of the hub the board rig cannot
 * reach. Dev-server only, same as harness/sports.tsx:
 *
 *   pnpm --filter @blammytv/app dev
 *   http://localhost:1420/harness/theater.html
 *
 * WHY A SECOND ENTRY. The board rig renders SportsScreen, which resolves
 * its own channels through useCatalog, which reads the live source. With no
 * playlist configured that catalog is EMPTY, so the theater it opens has a
 * matchup, an empty rail and some live scores. The rail is the half of the
 * panel that never appears, which is why the rail's own geometry kept being
 * argued about from arithmetic instead of measured.
 *
 * SportsTheater takes its catalog as a prop, so this hands it one built
 * from Adam's real 1,875-channel dump. Same components, same stylesheet,
 * real names through the real matcher: the rows that appear are the rows
 * the app would find.
 *
 * WHAT IS STAGED: the clock and the states, as on the board rig, so that
 * one live game can be the theater's subject and the rest can fill the live
 * scores. And the logos, because the dump deliberately carries no logo URLs
 * (it carries no stream URLs either, they hold credentials). A placeholder
 * stands in at the right size, since the row's height is set by the mark.
 */

/** The mark's box is 34px and the row is built around it, so the rig needs
 * something that size rather than nothing. Grey, and obviously not a real
 * channel logo. */
const LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34">' +
      '<rect width="34" height="34" rx="7" fill="#2a2a30"/>' +
      '<circle cx="17" cy="17" r="7" fill="#4a4a55"/></svg>',
  );

const catalog = indexChannels(
  (channels as { name: string; quality: string | null }[]).map(
    (c, i): Tunable => ({
      id: `rig-${i}`,
      name: c.name,
      quality: c.quality,
      logo: LOGO,
    }),
  ),
);

/** Restamp a saved slate onto today and set it running, so the theater has
 * a live subject and a full list of live scores under it. */
const PATHS: Record<string, string> = {
  mlb: "baseball/mlb",
  nba: "basketball/nba",
  nhl: "hockey/nhl",
  epl: "soccer/eng.1",
};

function live(slate: unknown, key: string) {
  const raw = slate as { events?: { competitions: unknown[] }[] };
  const detail: Record<string, string> = {
    mlb: "Bot 7th",
    nba: "Q3 4:11",
    nhl: "2nd 12:04",
    epl: "63'",
  };
  const start = new Date();
  start.setHours(start.getHours() - 1, 0, 0, 0);
  return toGames(
    {
      ...(raw as object),
      events: (raw.events ?? []).map((e) => ({
        ...e,
        date: start.toISOString(),
        competitions: [
          {
            ...(e.competitions[0] as object),
            status: { type: { state: "in", shortDetail: detail[key] } },
          },
        ],
      })),
    },
    PATHS[key],
  );
}

/**
 * FIXTURES only, which the union now makes explicit. The theater takes two
 * sides and a score; racing reaches it in plan 010 #5 and tournaments are a
 * list rather than a thing you watch.
 */
const games = [
  ...live(mlb, "mlb"),
  ...live(nba, "nba"),
  ...live(nhl, "nhl"),
  ...live(epl, "epl"),
].filter(isFixture);

applyAccent(loadAccent());
applyTheme(loadTheme());

export function Rig() {
  const [open, setOpen] = React.useState(games[0]);
  return (
    <SportsTheater
      game={open}
      others={games.filter((g) => g.id !== open.id)}
      catalog={catalog}
      // The theater hands back a Game because its rail can hold any kind;
      // this rig only ever stocks fixtures, and the guard is what says so.
      onOpen={(g) => {
        if (isFixture(g)) setOpen(g);
      }}
      onClose={() => undefined}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Rig />
  </React.StrictMode>,
);
