// Single source of truth for the top-level "module" navigation — the
// major functional areas of the product. The workspace (Design) and the
// scaffold module pages all read this list so the tab bar stays in sync.
//
// `match` decides whether a tab is the active one for a given pathname;
// it defaults to an exact match on `to` when omitted.
import {
  Box,
  Layers,
  Image as ImageIcon,
  Library,
  ClipboardList,
  Factory,
  Boxes,
} from "lucide-react";

export const MODULES = [
  {
    id: "design",
    label: "Design",
    icon: Box,
    to: "/workspace",
    match: (p) => p.startsWith("/workspace"),
    hint: "Parametric 3D CAD workspace",
  },
  {
    id: "slice",
    label: "Slice",
    icon: Layers,
    to: "/slice",
    hint: "Prepare & slice for printing",
  },
  {
    id: "lithoforge",
    label: "LithoForge",
    icon: ImageIcon,
    to: "/lithoforge",
    companion: true,
    hint: "Photo → lithophane companion module",
  },
  {
    id: "library",
    label: "Library",
    icon: Library,
    to: "/gallery",
    match: (p) => p.startsWith("/gallery"),
    hint: "Designs, components & the public gallery",
  },
  {
    id: "orders",
    label: "Orders",
    icon: ClipboardList,
    to: "/orders",
    hint: "Customer orders & quoting",
  },
  {
    id: "production",
    label: "Production",
    icon: Factory,
    to: "/production",
    hint: "Print-farm scheduling & job queue",
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: Boxes,
    to: "/inventory",
    hint: "Filament & materials stock",
  },
];

export function activeModuleId(pathname) {
  const hit = MODULES.find((m) =>
    m.match ? m.match(pathname) : pathname === m.to,
  );
  return hit ? hit.id : null;
}
