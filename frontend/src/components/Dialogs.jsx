// Barrel re-export — the dialogs were split out into
// `/app/frontend/src/components/dialogs/*.jsx` for maintainability. Existing
// imports (`import { ShareDialog, ... } from "./Dialogs"`) keep working.
export { ShareDialog } from "./dialogs/ShareDialog";
export { OrcaDialog } from "./dialogs/OrcaDialog";
export { SavePrinterDialog } from "./dialogs/SavePrinterDialog";
export { SaveComponentDialog } from "./dialogs/SaveComponentDialog";
