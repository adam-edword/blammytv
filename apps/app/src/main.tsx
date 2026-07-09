import React from "react";
import ReactDOM from "react-dom/client";
import "./fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/settings.css";
import "./styles/live.css";
import "./styles/player.css";
import { App } from "./app/App";
import { TheaterOverlay } from "./features/live/TheaterOverlay";
import { SpikeScreen } from "./features/spike/SpikeScreen";
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

// The native player composites a second webview of THIS bundle over the mpv
// video, loaded with `?overlay=1`. That instance renders only the transparent
// TheaterOverlay — and must clear the black launch background so the video
// shows through.
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
} else if (params.get("spike") === "1") {
  // DEV layer-inversion spike: a transparent window with native video parked
  // BELOW the webview — the page's hole must reveal it (see spike.rs).
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  root.render(
    <React.StrictMode>
      <SpikeScreen />
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
