import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TheaterOverlay } from "./components/TheaterOverlay";
import { initPreferences } from "./state/preferences";
import { PreferencesProvider } from "./state/PreferencesProvider";
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
  root.render(
    <React.StrictMode>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </React.StrictMode>,
  );
}
