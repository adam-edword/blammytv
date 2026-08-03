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
import { SportsScreen } from "../src/features/sports/SportsScreen";
import { applyAccent, loadAccent } from "../src/features/settings/accent";
import { applyTheme, loadTheme } from "../src/features/settings/theme";
import epl from "./fixtures/epl.json";
import mlb from "./fixtures/mlb.json";
import nba from "./fixtures/nba.json";
import nfl from "./fixtures/nfl.json";
import nhl from "./fixtures/nhl.json";
import f1 from "./fixtures/f1-season.json";
import tennis from "./fixtures/tennis.json";

/**
 * Layout rig for the Sports hub. Dev-server only: this is its own Vite
 * entry rather than a flag on main.tsx, because the fixtures below would
 * otherwise be bundled into the shipping app.
 *
 * It exists to answer questions about GEOMETRY at a given viewport, which
 * is not a thing the unit tests can see and not a thing worth guessing at.
 * The hub was designed on a 4K panel and most people are on 1920x1080, and
 * the only honest way to know what that costs is to render it and measure.
 *
 *   pnpm --filter blammytv-app dev
 *   http://localhost:1420/harness/sports.html
 *
 * WHAT IS REAL: the components, the stylesheet, the team names, crests,
 * colours, venues, broadcasts and scores. Five real slates, 42 games,
 * pruned to the paths espn.ts reads (same treatment as the test fixtures).
 *
 * WHAT IS STAGED: the dates and the states. The slates are real past days,
 * so left alone every card would be a Final on a date the hub filters out.
 * They get restamped onto the day being asked for and dealt states so that
 * all three card layouts are on screen at once, which is the point: a rig
 * that only ever shows one of the three cannot tell you the other two fit.
 */

/** ESPN's own words for a game in progress. Only the sport knows how it
 * counts, and the wide card's centre column is sized around these. */
const LIVE_DETAIL: Record<string, string> = {
  nfl: "3rd 07:22",
  nba: "Q3 4:11",
  mlb: "Bot 7th",
  nhl: "2nd 12:04",
  epl: "63'",
};

/**
 * Only the two paths this file rewrites. Everything else in a slate is
 * passed through untouched, so it does not need naming here: espn.ts owns
 * the real shape and this rig has no business restating it.
 */
interface Slate {
  events?: {
    competitions: {
      status?: { type?: { shortDetail?: string } };
      competitors?: unknown[];
    }[];
  }[];
}

/**
 * Records and a note, dealt onto every card.
 *
 * Staged like the dates and the states above, and for the same reason: the
 * captures predate the fields, and a rig that shows the record on none of
 * its cards cannot tell you whether the record fits. This is the WORST
 * case on purpose. In life 86% of games carry a record and 8% carry a
 * note, and a rig measuring the common case would measure the easy one.
 *
 * The widest shapes each sport actually sends: NHL keeps three columns
 * ("41-25-16"), soccer keeps draws ("12-10-16"), the rest keep two.
 */
const RECORDS: Record<string, [string, string]> = {
  nfl: ["12-5", "9-8"],
  nba: ["52-30", "46-36"],
  mlb: ["59-53", "104-58"],
  nhl: ["41-25-16", "43-27-12"],
  epl: ["12-10-16", "22-8-8"],
};

/** Real strings, from a real playoff board and a real August one. */
const NOTES = [
  "CLE leads series 2-0",
  "Series tied 1-1",
  "East 1st Round - Game 2",
  "Hall of Fame Game",
];

const SLATES: Record<string, Slate> = { nfl, nba, mlb, nhl, epl };

/**
 * Where in the day a game kicks off. Wrapped inside the day on purpose: an
 * unwrapped `11 + i` runs past midnight for a 15-game MLB slate, and those
 * games then land on TOMORROW and get filtered straight back out, which
 * quietly shrinks the board you thought you were measuring.
 */
function startHour(index: number) {
  return 11 + (index % 12);
}

/**
 * Deal a day's events across the three states, BY KICK-OFF TIME.
 *
 * Off the clock rather than off the index, because that is the one property
 * a real board has that a shuffled one does not: games that started earlier
 * are further along. Dealing by index instead interleaves finals and
 * fixtures once several leagues are merged and sorted, which makes the
 * grids look far more ragged than they ever are in life. The rig has to be
 * wrong in ways that do not matter, and that one matters.
 *
 * Only today gets a mix; later days are entirely fixtures, which is what a
 * board two days out actually looks like.
 */
function stateFor(dayOffset: number, index: number) {
  if (dayOffset > 0) return "pre";
  const hour = startHour(index);
  if (hour < 15) return "post";
  if (hour < 18) return "in";
  return "pre";
}

/** The requested day as a local Date, from the endpoint's own YYYYMMDD. */
function parseDates(url: string): Date {
  const raw = new URL(url, location.origin).searchParams.get("dates");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!raw || raw.length !== 8) return today;
  return new Date(
    Number(raw.slice(0, 4)),
    Number(raw.slice(4, 6)) - 1,
    Number(raw.slice(6, 8)),
  );
}

function restamp(slate: Slate, league: string, day: Date) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const dayOffset = Math.round(
    (day.getTime() - midnight.getTime()) / (24 * 3600_000),
  );
  const events = slate.events ?? [];
  return {
    ...slate,
    events: events.map((e, i) => {
      const state = stateFor(dayOffset, i);
      // Spread across the day, so the row is a day in order rather than a
      // stack of games all at the same minute.
      const start = new Date(day);
      start.setHours(startHour(i), (i * 25) % 60, 0, 0);
      const c = e.competitions[0];
      return {
        ...e,
        date: start.toISOString(),
        competitions: [
          {
            ...c,
            status: {
              type: {
                state,
                shortDetail:
                  state === "in"
                    ? LIVE_DETAIL[league]
                    : (c.status?.type?.shortDetail ?? "Final"),
              },
            },
            // Every card, which is not what a real board looks like. See
            // RECORDS: the point of a rig is the worst case.
            competitors: (c.competitors ?? []).map((x, side) => ({
              ...(x as object),
              records: [
                { type: "total", summary: RECORDS[league][side] ?? "10-10" },
              ],
            })),
            series: { summary: NOTES[i % NOTES.length] },
          },
        ],
      };
    }),
  };
}

/**
 * Stand in for ESPN, and only for ESPN: crests still come off the real CDN,
 * because a card measured without its art is not the card.
 */
/**
 * The board's three no-cards states, on demand: ?state=loading|error|empty.
 *
 * Same argument the dealt states above make. A rig that can only ever show
 * the happy path cannot tell you whether the skeleton lines up with the
 * board it becomes, or whether an empty state's sentence fits on one line,
 * and those are geometry questions exactly like the card ones.
 *
 *   loading  every scoreboard call hangs, so the skeleton stays up
 *   error    every one rejects, which is what a total outage looks like
 *   empty    every one answers 200 with no events
 */
const FORCED = new URL(location.href).searchParams.get("state");

/**
 * Is this the "what is next" call rather than a call about a day?
 *
 * By the SHAPE of `dates`, not by its absence: racing asks for a whole
 * season (`dates=2026`, four digits) where everything else asks bare, and
 * a window call is always eight (`dates=20260803`). Checking only for the
 * parameter's absence made the season call look like a window call, which
 * quietly emptied the reach.
 */
const isNextCall = (url: string) => {
  const d = new URL(url, location.origin).searchParams.get("dates");
  return !d || d.length === 4;
};

const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const m = /sports\/[^/]+\/([^/]+)\/scoreboard/.exec(url);
  if (m && FORCED) {
    if (FORCED === "loading") return new Promise<Response>(() => {});
    if (FORCED === "error") return Promise.reject(new Error("forced"));
    /* "next" empties the WINDOW but leaves the bare call answering, which
     * is the only way to see #36 here: every league is out of season, so
     * the board has nothing to draw until it reaches ahead. */
    if (FORCED !== "next" || !isNextCall(url)) {
      return Promise.resolve(
        new Response(JSON.stringify({ events: [] }), {
          headers: { "content-type": "application/json" },
        }),
      );
    }
  }

  if (m && isNextCall(url)) {
    const when = new Date();
    when.setHours(0, 0, 0, 0);
    when.setDate(when.getDate() + 19);
    when.setHours(14, 30, 0, 0);
    /* RACING answers with a whole weekend, which is the case that matters:
     * the board folds it into one WeekendCard rather than five session
     * cards under three dated headings. Friday, Friday, Saturday,
     * Saturday, Sunday, which is the real shape of one. */
    if (m[1] === "f1") {
      /* THE REST OF THE SEASON, which is what the real endpoint answers
       * for a racing league asked about a year: measured 2026-08-03, F1
       * returned all 25 rounds with 12 still ahead. Adam, on seeing one:
       * "shouldn't there be more than just NED? like the rest of the
       * schedule should be showing".
       *
       * The season fixture holds real rounds at real circuits; they get
       * restamped onto fortnightly weekends from three weeks out, so the
       * rig shows the same SHAPE the live board does. */
      const OFFSET = [0, 0, 1, 1, 2];
      const HOUR = [11, 15, 11, 15, 14];
      const rounds = (f1.events ?? []).slice(0, 12);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ...f1,
            events: rounds.map((event, round) => {
              const friday = new Date(when);
              friday.setDate(friday.getDate() + round * 14);
              return {
                ...event,
                date: friday.toISOString(),
                competitions: (event.competitions ?? []).map((c, i) => {
                  const at = new Date(friday);
                  at.setDate(at.getDate() + OFFSET[i]);
                  at.setHours(HOUR[i], 0, 0, 0);
                  return {
                    ...c,
                    date: at.toISOString(),
                    status: { type: { state: "pre" } },
                  };
                }),
              };
            }),
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    }
    const slate = SLATES[m[1] === "eng.1" ? "epl" : (m[1] ?? "")] ?? nba;
    const first = (slate.events ?? [])[0];
    if (!first) {
      return Promise.resolve(
        new Response(JSON.stringify({ events: [] }), {
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ...slate,
          events: [
            {
              ...first,
              date: when.toISOString(),
              competitions: [
                {
                  ...first.competitions[0],
                  date: when.toISOString(),
                  status: { type: { state: "pre" } },
                },
              ],
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  }

  /* RACING, restamped onto this weekend like every other slate.
   *
   * The real endpoint answers a date inside a race weekend with all five
   * sessions and a date outside one with nothing, and the board relies on
   * that: it asks per day and `onDay` files each session. F1 is between
   * races most of the time, so a rig replaying the calendar verbatim shows
   * an empty board, which cannot answer the question the rig is open to
   * answer.
   *
   * So one real weekend (circuit, drivers, flags, broadcast) is moved onto
   * today, tomorrow and the day after, and dealt states so a session is
   * live. Same treatment the team slates get, for the same reason. */
  if (m && m[1] === "f1") {
    const day = parseDates(url);
    const event = (f1.events ?? [])[0];
    const comps = event.competitions ?? [];
    // Friday's two, Saturday's two, Sunday's one: the shape of a weekend.
    const OFFSET = [0, 0, 1, 1, 2];
    const HOUR = [11, 15, 11, 15, 14];
    const restamped = comps.map((c, i) => {
      const when = new Date();
      when.setHours(0, 0, 0, 0);
      when.setDate(when.getDate() + OFFSET[i]);
      when.setHours(HOUR[i], 0, 0, 0);
      return {
        ...c,
        date: when.toISOString(),
        status:
          i === 1
            ? { period: 41, type: { state: "in", shortDetail: "Lap 41/72" } }
            : i === 0
              ? { type: { state: "post", shortDetail: "Final" } }
              : { type: { state: "pre" } },
      };
    });
    // Outside the weekend, nothing, which is what the real one does.
    const inside = OFFSET.some((o) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + o);
      return d.toDateString() === day.toDateString();
    });
    return Promise.resolve(
      new Response(
        JSON.stringify(
          inside
            ? { ...f1, events: [{ ...event, competitions: restamped }] }
            : { ...f1, events: [] },
        ),
        { headers: { "content-type": "application/json" } },
      ),
    );
  }
  /* TENNIS, which is the only slate that is not a list of fixtures.
   *
   * A real National Bank Open board, two days of it: 117 matches across
   * three draws, with the states the source actually sent (19 finished,
   * 4 on court, 94 to come). The adapter folds each day into ONE card, and
   * that fold is the whole reason this fixture exists — a rig that only
   * ever showed team sports could not tell you whether the tournament card
   * fits the grid beside them.
   *
   * Restamped by DAY rather than per match: the capture's two dates are
   * mapped onto today and tomorrow in order, so every match keeps its own
   * time of day and the day's shape survives. */
  if (m && (m[1] === "atp" || m[1] === "wta")) {
    const want = parseDates(url);
    const groupings = tennis.events[0].groupings ?? [];
    const dates = [
      ...new Set(
        groupings.flatMap((g) =>
          (g.competitions ?? []).map((c) => new Date(c.date).toDateString()),
        ),
      ),
    ].sort((a, b) => Date.parse(a) - Date.parse(b));
    /** The capture's nth day becomes today + n. */
    const shift = (iso: string) => {
      const was = new Date(iso);
      const i = dates.indexOf(was.toDateString());
      const when = new Date();
      when.setHours(0, 0, 0, 0);
      when.setDate(when.getDate() + (i < 0 ? 0 : i));
      when.setHours(was.getHours(), was.getMinutes(), 0, 0);
      return when.toISOString();
    };
    const moved = {
      ...tennis,
      events: [
        {
          ...tennis.events[0],
          groupings: groupings.map((g) => ({
            ...g,
            competitions: (g.competitions ?? [])
              .map((c) => ({ ...c, date: shift(c.date) }))
              // The endpoint answers per day, and the board asks per day.
              .filter(
                (c) => new Date(c.date).toDateString() === want.toDateString(),
              ),
          })),
        },
      ],
    };
    return Promise.resolve(
      new Response(JSON.stringify(moved), {
        headers: { "content-type": "application/json" },
      }),
    );
  }
  // ESPN's soccer path is the competition code, not our key.
  const key =
    m && Object.keys(SLATES).find((k) => k === m[1] || (m[1] === "eng.1" && k === "epl"));
  if (key) {
    return Promise.resolve(
      new Response(JSON.stringify(restamp(SLATES[key], key, parseDates(url))), {
        headers: { "content-type": "application/json" },
      }),
    );
  }
  /* THE BARE CALL, which is "what is next" rather than "what is on today".
   *
   * The board asks this of a followed league that had nothing in its
   * window (#36), and the real endpoint answers with that league's next
   * fixture however far out it is: measured 2026-08-03, the NBA came back
   * 2026-10-03. A rig that answered empty here could not show the one
   * thing #36 exists to do, which is put a Grand Prix nineteen days out
   * on the grid.
   *
   * Nineteen days, from the real F1 gap that prompted it. One event, so
   * the reached day reads the way a real one does: a heading with its own
   * date and a card or two under it, not a second full board. */
  /* ANY OTHER LEAGUE: out of season, which is what most of them are.
   *
   * It used to fall through to the real endpoint, and that stopped being
   * survivable the moment an empty follow store began asking for all 151
   * catalog leagues: the rig fired 302 live requests it had no fixture for,
   * and the board sat on "Loading" behind them. A 200 with no events is
   * also the honest answer — it is exactly what ESPN sends for a league
   * between seasons, which on any given day is most of the catalog.
   *
   * Only SCOREBOARD urls. Crests still come off the real CDN, because a
   * card measured without its art is not the card. */
  if (m) {
    return Promise.resolve(
      new Response(JSON.stringify({ events: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );
  }
  return realFetch(input, init);
};

applyAccent(loadAccent());
applyTheme(loadTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SportsScreen />
  </React.StrictMode>,
);
