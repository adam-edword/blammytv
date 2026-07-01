import React from "react";
import ReactDOM from "react-dom/client";
import "./fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./app/App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
