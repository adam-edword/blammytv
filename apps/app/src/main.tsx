import React from "react";
import ReactDOM from "react-dom/client";
import "./fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/settings.css";
import { App } from "./app/App";
import { applyAccent, loadAccent } from "./features/settings/accent";
import { applyTheme, loadTheme } from "./features/settings/theme";
import { applyUiScale, loadUiScale } from "./features/settings/uiScale";

// Apply saved accent, theme, and scale before first paint so nothing flashes.
applyAccent(loadAccent());
applyTheme(loadTheme());
applyUiScale(loadUiScale());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
