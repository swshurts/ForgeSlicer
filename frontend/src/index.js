import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { bootstrapTheme } from "@/lib/theme";

// Apply the stored theme to <html data-theme="…"> BEFORE React mounts
// so the first paint never flashes the wrong palette.
bootstrapTheme();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
