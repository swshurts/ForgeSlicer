// Iter-90 — Profile / preferences action slice extracted from
// `lib/store.js`. These actions all manage the user's chosen printer
// + filament + workspace preferences (auto-drop, my-default-printer)
// and several persist to localStorage so the next workspace mount
// restores the same selection.
//
// Spread into the main Zustand store via:
//   ...createProfileActions({ get, set, deps: { PRINTERS, getPrinter, defaultPrinterId } })
//
// No external React imports — pure pushHistory-style action slice.

const safeLocalSet = (k, v) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (v == null || v === false) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, typeof v === "boolean" ? "true" : v);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`persist ${k} failed:`, err);
  }
};

export function createProfileActions({ get, set, deps }) {
  const { PRINTERS, getPrinter, defaultPrinterId } = deps;

  return {
    setPrinter: (id) => {
      const s = get();
      // Look in built-in first, then community
      let p = PRINTERS.find((x) => x.id === id);
      if (!p) {
        const c = s.communityPrinters.find((x) => x.id === id);
        if (c) {
          // Map community-printer row shape → buildVolume shape the
          // store expects. Field names are different on each side
          // (community uses `build_x`/`build_y`/`build_z`, the in-
          // memory shape uses `{x,y,z}`).
          p = {
            id: c.id,
            brand: c.brand,
            name: c.name,
            buildVolume: { x: c.build_x, y: c.build_y, z: c.build_z },
            maxNozzleTemp: c.max_nozzle_temp,
            maxBedTemp: c.max_bed_temp,
            defaultNozzle: c.default_nozzle,
            defaultPrintSpeed: c.default_print_speed,
          };
        }
      }
      if (!p) p = getPrinter(defaultPrinterId);
      set({ printerId: p.id, buildVolume: { ...p.buildVolume } });
    },
    setFilament: (id) => set({ filamentId: id }),

    // Mark the currently-selected printer as "my default" — written to
    // localStorage so the next workspace mount restores it automatically.
    // Pass `null` to clear the preference.
    setMyPrinter: (id) => {
      safeLocalSet("forge.printer.mine", id || null);
      set({ myPrinterId: id || null });
    },

    setAutoDropOnRotate: (v) => {
      safeLocalSet("forge.autoDropOnRotate", !!v);
      set({ autoDropOnRotate: !!v });
    },
    setAutoDropNew: (v) => {
      safeLocalSet("forge.autoDropNew", !!v);
      set({ autoDropNew: !!v });
    },

    setCommunityPrinters: (list) => set({ communityPrinters: list }),
    addCommunityPrinter: (p) =>
      set((s) => ({ communityPrinters: [p, ...s.communityPrinters] })),
    removeCommunityPrinter: (id) =>
      set((s) => ({
        communityPrinters: s.communityPrinters.filter((c) => c.id !== id),
      })),
  };
}
