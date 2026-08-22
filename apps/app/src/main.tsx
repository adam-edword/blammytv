import React from "react";
import ReactDOM from "react-dom/client";
import "./fonts";
import "./styles/tokens.css";
import "./styles/packs.css";
import "./styles/intense-packs.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/settings.css";
import "./styles/themes.css";
import "./styles/live.css";
import "./styles/player.css";
import "./styles/stream.css";
import "./styles/sports.css";
import "./styles/discover.css";
import "./styles/boot.css";
import "./styles/onboarding.css";
import { App } from "./app/App";
import { TheaterOverlay } from "./features/live/TheaterOverlay";
import { SportsTheater } from "./features/sports/SportsTheater";
import { useCatalog } from "./features/sports/catalog";
import type { Fixture } from "./features/sports/model";
import { isTauri } from "./lib/tauri";
import { installPlayerPerf } from "./lib/playerPerf";
import {
  applyAccent,
  applyAurora,
  loadAccent,
  loadAccentStyle,
} from "./features/settings/accent";
import { applyTheme, loadTheme } from "./features/settings/theme";
import { applyThemePack, loadThemePack } from "./features/settings/themePacks";
import { applyUiScale, loadUiScale } from "./features/settings/uiScale";
import {
  applyCornerStyle,
  loadCornerStyle,
} from "./features/settings/cornerStyle";
import { applyInstalledPacks } from "./features/settings/license";

// Apply saved appearance before first paint so nothing flashes.
if (loadAccentStyle() === "aurora") applyAurora();
else applyAccent(loadAccent());
applyTheme(loadTheme());
applyThemePack(loadThemePack());
applyUiScale(loadUiScale());
applyCornerStyle(loadCornerStyle());
// Paid theme CSS, purely from cache — see license.ts's fail-open comment.
applyInstalledPacks();

// `playerPerf(seconds)` in the devtools console — the player perf probe
// (plan 011). Installed for both entries so the overlay harness can use it too.
installPlayerPerf();

const root = ReactDOM.createRoot(document.getElementById("root")!);

// TEST HARNESS: `?overlay=1` renders the player chrome standalone (bare
// TheaterOverlay on a transparent page) so scripts/verify-overlay-tracks.mjs
// can drive it headlessly with a mocked window.overlayApi. It was the comp.rs
// overlay webview's entry before the v0.2.0 deletion; it survives only for
// that harness — the shipping app never loads it.
const params = new URLSearchParams(window.location.search);
if (params.get("overlay") === "1") {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.body.classList.add("is-overlay");
  root.render(
    <React.StrictMode>
      <TheaterOverlay />
    </React.StrictMode>,
  );
} else if (params.get("sportstheater") === "1") {
  // TEST HARNESS: `?sportstheater=1` mounts the SPORTS host of the player
  // chrome, for scripts/verify-sports-theater.mjs.
  //
  // Why a second seam rather than reusing `?overlay=1`: that one renders a
  // bare TheaterOverlay against a mocked `window.overlayApi`, which is a
  // mock of the very thing the sports host's risk lives in. SportsTheater
  // goes through `useDirectOverlay`, and every one of its player paths is
  // gated on `isTauri()`. So the harness stubs the IPC boundary
  // (`window.__TAURI_INTERNALS__`) instead and this entry drives the REAL
  // useDirectOverlay, which is what the v0.8.188-203 player work rewrote
  // underneath a screen nobody had opened since.
  //
  // The fixture comes in on `window.__sportsFixture` so the harness owns the
  // scenario. `start` crosses as an ISO string because it is a Date. The
  // CHANNELS are not part of it: the catalog comes from `useCatalog`, the
  // same hook the board uses, so the rail resolves and tunes exactly as it
  // does in the app rather than against a hand-built index.
  const f = (
    window as unknown as {
      __sportsFixture?: {
        game: Omit<Fixture, "start"> & { start: string };
        others?: (Omit<Fixture, "start"> & { start: string })[];
      };
    }
  ).__sportsFixture;
  const revive = (g: Omit<Fixture, "start"> & { start: string }): Fixture => ({
    ...g,
    start: new Date(g.start),
  });
  function SportsHarness({ game, others }: { game: Fixture; others: Fixture[] }) {
    return (
      <SportsTheater
        game={game}
        others={others}
        catalog={useCatalog()}
        onOpen={() => {}}
        onClose={() => {}}
      />
    );
  }
  if (isTauri()) document.documentElement.classList.add("invert-player");
  root.render(
    <React.StrictMode>
      {f ? (
        <SportsHarness
          game={revive(f.game)}
          others={(f.others ?? []).map(revive)}
        />
      ) : null}
    </React.StrictMode>,
  );
} else {
  // Native shell (the window is transparent): stamp the root class BEFORE
  // first paint so the shell (not body) owns the background — see base.css
  // .invert-player. In a plain browser tab the body stays opaque.
  if (isTauri()) document.documentElement.classList.add("invert-player");
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
