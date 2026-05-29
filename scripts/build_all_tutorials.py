#!/usr/bin/env python3
"""Rebuild every tutorial PDF in one shot.

Useful after editing tutorial_lib.py (palette / chrome changes) so all
PDFs stay in sync. Run from /app:
    python3 scripts/build_all_tutorials.py
"""
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
BUILD_SCRIPTS = sorted(SCRIPTS.glob("build_*_tutorial.py"))

if __name__ == "__main__":
    failures = []
    for s in BUILD_SCRIPTS:
        print(f"\n=== {s.name} ===")
        r = subprocess.run([sys.executable, str(s)])
        if r.returncode != 0:
            failures.append(s.name)
    if failures:
        print("\nFAILED:", failures)
        sys.exit(1)
    print("\nAll tutorials rebuilt successfully.")
