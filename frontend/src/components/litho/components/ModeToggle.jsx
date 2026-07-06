// iter-128 — ModeToggle stub.
//
// LithoForge's original ModeToggle picked between Lithophane / Painting
// / etc. render modes. We now surface render_mode as a plain select
// inside ConfigPanel, so ModeToggle becomes a no-op passthrough (the
// import in ConfigPanel is preserved but the component renders nothing).
// If future UX asks for a segmented control we can re-fill this in.
export function ModeToggle() {
  return null;
}

export default ModeToggle;
