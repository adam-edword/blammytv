import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TheaterOverlay } from "./components/TheaterOverlay";
import { initPreferences } from "./state/preferences";
import { PreferencesProvider } from "./state/PreferencesProvider";
import { UpdaterProvider } from "./state/UpdaterProvider";
import { init as initSpatialNav } from "@noriginmedia/norigin-spatial-navigation";
import "./fonts";
import "./styles.css";
import "./lib/fpsmeter"; // TEMP: perf overlay while tuning row-nav jank

const root = ReactDOM.createRoot(document.getElementById("root")!);

// The native-theater overlay window loads this same bundle with ?overlay=1 — it
// renders only the transparent theater chrome over the native mpv surface.
const isOverlay =
  new URLSearchParams(window.location.search).get("overlay") === "1";

if (isOverlay) {
  document.body.classList.add("is-overlay");
  root.render(
    <React.StrictMode>
      <TheaterOverlay />
    </React.StrictMode>,
  );
} else {
  initPreferences();
  // TV remote navigation: the WebView delivers the D-pad as arrow keydowns, so
  // norigin's spatial navigation drives focus across the UI. Throttle so a held
  // key doesn't race through focusables. useGetBoundingClientRect gives true
  // viewport coordinates so focus can move *between* containers (e.g. the header
  // tabs down into the scrolling content) — offset-based measurement can't.
  initSpatialNav({
    // Lower throttle so holding ◀/▶ on a row advances at a responsive rate
    // (100ms capped it at ~10 cards/sec, which felt "held back").
    throttle: 60,
    throttleKeypresses: true,
    useGetBoundingClientRect: true,
  });
  root.render(
    <React.StrictMode>
      <UpdaterProvider>
        <PreferencesProvider>
          <App />
        </PreferencesProvider>
      </UpdaterProvider>
    </React.StrictMode>,
  );
}
