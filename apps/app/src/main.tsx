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
  // key doesn't race through focusables.
  initSpatialNav({ throttle: 100, throttleKeypresses: true });
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
