#!/usr/bin/env python3
"""Apply verified fixes to Watched-Tracker index.html (run from repo root).
Each edit must match exactly once, unless the replacement is already present.
"""
import sys, pathlib

EDITS = [
    ("viewport: allow pinch-zoom",
     'initial-scale=1.0, user-scalable=no, viewport-fit=cover',
     'initial-scale=1.0, viewport-fit=cover'),
    ("metadata refresh: never zero episode progress when a season count is missing",
     'else curEp=Math.min(curEp,Number(airedEpisodeCounts[curSeason]||0));',
     'else if(Number(airedEpisodeCounts[curSeason]||0)>0)curEp=Math.min(curEp,Number(airedEpisodeCounts[curSeason]));'),
    ("mergeLibraries: first list (cloud) wins timestamp ties",
     'if(!prev||toMillis(raw.updatedAt||raw.date)>=toMillis(prev.updatedAt||prev.date))',
     'if(!prev||toMillis(raw.updatedAt||raw.date)>toMillis(prev.updatedAt||prev.date))'),
    ("editor modal: dvh so it is not clipped by Safari toolbar",
     'max-height:90vh;overflow-y:auto;overflow-x:hidden',
     'max-height:90vh;max-height:90dvh;overflow-y:auto;overflow-x:hidden'),
]

path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "index.html")
text = path.read_text(encoding="utf-8")
applied = 0
for name, old, new in EDITS:
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        text = text.replace(old, new)
        applied += 1
    elif old_count == 0 and new_count == 1:
        continue
    else:
        sys.exit(f"ABORTED: '{name}' has old={old_count}, new={new_count}; expected exactly one side. Nothing written.")
path.write_text(text, encoding="utf-8")
print(f"Verified {len(EDITS)} fixes in {path}; applied {applied} change(s).")
