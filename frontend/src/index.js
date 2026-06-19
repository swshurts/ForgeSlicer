import React from "react";
import ReactDOM from "react-dom/client";
import * as THREE from "three";
import "@/index.css";
import App from "@/App";
import { bootstrapTheme } from "@/lib/theme";

// iter-104.1 — CAD Z-up axis convention. Every Three.js Object3D
// (Mesh, Camera, OrbitControls target, etc.) created after this line
// uses +Z as its "up" direction. This must run BEFORE any React
// component renders, otherwise objects constructed during the first
// pass capture the old default (+Y). See /app/memory/AXIS_MIGRATION_PLAN.md.
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

// Apply the stored theme to <html data-theme="…"> BEFORE React mounts
// so the first paint never flashes the wrong palette.
bootstrapTheme();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
