import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PreferencesProvider, initPreferences } from "./state/preferences";
import "./fonts";
import "./styles.css";

initPreferences();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreferencesProvider>
      <App />
    </PreferencesProvider>
  </React.StrictMode>,
);
