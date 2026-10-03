#!/usr/bin/env python3
"""Apply and verify the four supplied Watched-Tracker fixes.

The source files are now split across index.html, assets/js/editor.js,
assets/js/sync.js, and assets/css/app.css. The script is idempotent: an
already-applied fix is accepted and is not duplicated.
"""
import pathlib
import sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

EDITS = [
    ("viewport: allow pinch-zoom",
     ROOT / "index.html",
     'initial-scale=1.0, user-scalable=no, viewport-fit=cover',
     'initial-scale=1.0, viewport-fit=cover'),
    ("metadata refresh: preserve episode progress when release metadata is missing",
     ROOT / "assets/js/editor.js",
     'const available=releases[Number(item.curSeason||0)]||[],requested=Number(item.curEp||0),validEpisode=Math.max(0,...available.filter(episode=>episode<=requested));',
     'const available=releases[Number(item.curSeason||0)]||[],requested=Number(item.curEp||0),validEpisode=available.length?Math.max(0,...available.filter(episode=>episode<=requested)):requested;'),
    ("mergeLibraries: first list (cloud) wins timestamp ties",
     ROOT / "assets/js/sync.js",
     'if(!prev||toMillis(raw.updatedAt||raw.date)>=toMillis(prev.updatedAt||prev.date))',
     'if(!prev||toMillis(raw.updatedAt||raw.date)>toMillis(prev.updatedAt||prev.date)'),
    ("editor modal: dvh so it is not clipped by Safari toolbar",
     ROOT / "assets/css/app.css",
     'max-height:90vh;overflow-y:auto;overflow-x:hidden',
     'max-height:90vh;max-height:90dvh;overflow-y:auto;overflow-x:hidden'),
]

for name, path, old, new in EDITS:
    if not path.exists():
        sys.exit(f"ABORTED: {name}: missing {path}")
    text = path.read_text(encoding="utf-8")
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        path.write_text(text.replace(old, new), encoding="utf-8")
        print(f"Applied: {name}")
    elif old_count == 0 and new_count == 1:
        print(f"Verified: {name}")
    else:
        sys.exit(f"ABORTED: {name}: old={old_count}, new={new_count}; expected exactly one state.")

print(f"Verified {len(EDITS)} fixes.")
