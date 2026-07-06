// iter-128 — MobileShell stub.
//
// LithoForge's original MobileShell wrapped the whole app in a bottom-
// tab layout on <768px viewports. For the in-app merge, we defer mobile
// polish to Phase 6 and just render children directly — the desktop
// layout still works on tablet+ screens which is the vast majority of
// lithophane creators. Kept as a passthrough so LithoStudio.jsx's
// import doesn't need to change.
export function MobileShell({ children }) {
  return <>{children}</>;
}

export default MobileShell;
