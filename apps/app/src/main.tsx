import React from "react";
import ReactDOM from "react-dom/client";
import "./fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/settings.css";
import { App } from "./app/App";
import { applyAccent, loadAccent } from "./features/settings/accent";

// Apply the saved accent before first paint so nothing flashes red.
applyAccent(loadAccent());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
