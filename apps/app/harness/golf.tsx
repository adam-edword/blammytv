import React from "react";
import ReactDOM from "react-dom/client";
import "../src/fonts";
import "../src/styles/tokens.css";
import "../src/styles/packs.css";
import "../src/styles/base.css";
import "../src/styles/ui.css";
import "../src/styles/themes.css";
import "../src/styles/sports.css";
import { GolfCard } from "../src/features/sports/GolfCard";
import { toGolf, type RawGolf } from "../src/features/sports/golf";
import { applyAccent, loadAccent } from "../src/features/settings/accent";
import { applyTheme, loadTheme } from "../src/features/settings/theme";
import done from "../src/features/sports/fixtures/golf-final.json";
import pre from "../src/features/sports/fixtures/golf-pre.json";

/**
 * Layout rig for the golf card (plan 010 #10). Dev-server only:
 *
 *   pnpm --filter blammytv-app dev
 *   http://localhost:1420/harness/golf.html
 *
 * WHAT IS REAL: both fixtures are real captures — a finished 3M Open and
 * the Wyndham Championship before anyone teed off — so the names, flags,
 * scores to par and field depth are the source's own.
 *
 * WHAT IS STAGED: the live state. Golf was between tournaments when this
 * was written, so the running card is the finished slate with its status
 * flipped and its last round truncated, which is the only way to see the
 * THRU header at all.
 */

const [final] = toGolf(done as RawGolf, "golf/pga");
const [upcoming] = toGolf(pre as RawGolf, "golf/pga");

/** The finished board, running: a mid-round leaderboard with THRU on it. */
const live = { ...final, state: "live" as const, session: "Round 4", thru: 14 };

/** The same card with no flags at all, which is what a 404 leaves behind. */
const flagless = {
  ...final,
  id: "flagless",
  entrants: final.entrants.map((e) => ({ ...e, mark: undefined })),
};

applyAccent(loadAccent());
applyTheme(loadTheme());

const sheet = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "24px",
        padding: "40px",
        background: "var(--bg)",
        minHeight: "100vh",
      }}
    >
      <GolfCard round={live} />
      <GolfCard round={final} />
      <GolfCard round={upcoming} />
      <GolfCard round={flagless} />
  </div>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {sheet}
  </React.StrictMode>,
);
