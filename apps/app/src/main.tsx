import React from "react";
import ReactDOM from "react-dom/client";
import "./fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/settings.css";
import "./styles/live.css";
import "./styles/player.css";
import "./styles/welcome.css";
import { App } from "./app/App";
import { TheaterOverlay } from "./features/live/TheaterOverlay";
import { isTauri } from "./lib/tauri";
import { applyAccent, loadAccent } from "./features/settings/accent";
import { applyTheme, loadTheme } from "./features/settings/theme";
import { applyUiScale, loadUiScale } from "./features/settings/uiScale";
import {
  applyCornerStyle,
  loadCornerStyle,
} from "./features/settings/cornerStyle";

// Apply saved appearance before first paint so nothing flashes.
applyAccent(loadAccent());
applyTheme(loadTheme());
applyUiScale(loadUiScale());
applyCornerStyle(loadCornerStyle());

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
