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
if (new URLSearchParams(window.location.search).get("overlay") === "1") {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.body.classList.add("is-overlay");
  // DIAGNOSTIC (v0.1.74): a GREEN banner injected into the DOM *before* React
  // runs. If the overlay webview loads its page and composites over the video,
  // this shows even if React later throws — so:
  //   green shows, pink (React) shows  → all good, controls were just subtle
  //   green shows, pink absent         → the page loads but React crashes
  //   neither shows                    → the webview never composites/loads
  //     (z-order / creation / URL — a native-side problem)
  const probe = document.createElement("div");
  probe.textContent = "overlay page loaded (pre-React)";
  probe.style.cssText =
    "position:fixed;top:0;left:0;right:0;padding:8px 12px;background:#12d18e;color:#000;font:700 14px system-ui,sans-serif;text-align:center;z-index:2147483647";
  document.body.appendChild(probe);
  root.render(<TheaterOverlay />);
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
