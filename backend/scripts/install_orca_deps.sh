#!/bin/bash
# OrcaSlicer runtime system-library installer.
#
# The official OrcaSlicer AppImage does NOT bundle its GUI / graphics
# stack — it links against ~40 system libraries (libEGL, libGL, GTK-3,
# WebKit-4.1, etc.) that have to be present on the host. Most cloud
# / container deploys ship without them, which is why a fresh install
# fails with:
#
#     bin/orca-slicer: error while loading shared libraries:
#     libEGL.so.1: cannot open shared object file
#
# This script installs the full known dep list. It is idempotent
# (apt-get install on an already-installed package is a no-op) and
# safe to run on every backend startup. Exits 0 on success or "no
# action needed", non-zero on hard install failure.
#
# Why a separate script and not Python? `apt-get` is the right tool
# for this job and bash makes the privilege check + retry logic obvious.
# Also: ops engineers can run this manually without touching Python.

set -uo pipefail

# Required for the OrcaSlicer v2.x AppImage on Debian / Ubuntu hosts.
# Pulled from `readelf -d bin/orca-slicer | grep NEEDED` on the
# v2.3.2 release. If a future Orca release adds new deps, add them
# here.
PACKAGES=(
  # ── Graphics / GL stack ──
  libegl1
  libgl1
  libglx0
  libglu1-mesa
  libopengl0
  # ── GTK + Pango + Cairo (chrome + text rendering) ──
  libgtk-3-0
  libpango-1.0-0
  libpangoft2-1.0-0
  libpangocairo-1.0-0
  libcairo2
  libcairo-gobject2
  libharfbuzz0b
  libgdk-pixbuf-2.0-0
  libatk1.0-0
  # ── WebKit (Orca's "connect to printer" web view) ──
  libwebkit2gtk-4.1-0
  libjavascriptcoregtk-4.1-0
  libsoup-3.0-0
  # ── X / Wayland session libraries ──
  libsm6
  libice6
  libx11-6
  libxext6
  libwayland-cursor0
  # ── Other runtime libs ──
  libsecret-1-0
  libmspack0
  libtiff6
  libbz2-1.0
  liblzma5
  libgstreamer1.0-0
  libgstreamer-plugins-base1.0-0
  libdbus-1-3
  libfontconfig1
)

log() {
  echo "[$(date -Iseconds)] install_orca_deps: $*"
}

# Privilege check — apt-get install needs root. On most container
# deploys the backend already runs as root; on locked-down ones the
# user should install these in the Dockerfile instead.
if [ "$(id -u)" -ne 0 ]; then
  log "Not root (uid=$(id -u)). Skipping system-dep install; user must"
  log "  add these to the container's Dockerfile:"
  log "    apt-get install -y ${PACKAGES[*]}"
  exit 0
fi

# apt-get available? Some minimal containers (Alpine, distroless) don't
# have it. Tell the user clearly rather than failing cryptically.
if ! command -v apt-get >/dev/null 2>&1; then
  log "apt-get not found — this script supports Debian / Ubuntu only."
  log "  Required packages: ${PACKAGES[*]}"
  exit 0
fi

# Skip if everything's already installed. dpkg-query is cheap, ~50 ms
# total for the 30-package check — avoids a needless apt-get update on
# every backend boot.
MISSING=()
for pkg in "${PACKAGES[@]}"; do
  if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed"; then
    MISSING+=("$pkg")
  fi
done
if [ ${#MISSING[@]} -eq 0 ]; then
  log "All ${#PACKAGES[@]} OrcaSlicer runtime deps already installed — no-op."
  exit 0
fi

log "Installing ${#MISSING[@]} missing packages: ${MISSING[*]}"

# Update the index unless it's recent — apt-get update is expensive
# and we don't need it on every startup. Threshold: 24 h.
LIST_TS=$(stat -c %Y /var/lib/apt/lists/ 2>/dev/null || echo 0)
NOW=$(date +%s)
AGE=$((NOW - LIST_TS))
if [ "$AGE" -gt 86400 ] || [ "$LIST_TS" -eq 0 ]; then
  log "Running apt-get update (list age ${AGE}s)…"
  if ! apt-get update >/dev/null 2>&1; then
    log "WARNING: apt-get update failed; trying install anyway with stale lists."
  fi
fi

if DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${MISSING[@]}" >/tmp/install_orca_deps.log 2>&1; then
  log "Installed ${#MISSING[@]} packages successfully."
  exit 0
else
  rc=$?
  log "apt-get install failed with rc=$rc. Tail of log:"
  tail -n 20 /tmp/install_orca_deps.log | sed "s/^/  /"
  exit $rc
fi
