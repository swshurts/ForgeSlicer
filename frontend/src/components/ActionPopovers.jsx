// Backward-compat shim. The popover implementations moved to
// `./popovers/*` in the 1.14 refactor (each popover in its own file).
// Existing imports keep working through this re-export; new code
// should import from `./popovers` directly.
export {
  PositionPopover, RotationPopover, ScalePopover,
  DuplicatePopover, MirrorPopover, SlicerPopover,
} from "./popovers";
