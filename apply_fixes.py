#!/usr/bin/env python3
"""Apply verified fixes to Watched-Tracker index.html (run from repo root).
Each edit must match exactly once, otherwise nothing is written."""
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
for name, old, new in EDITS:
    n = text.count(old)
    if n != 1:
        sys.exit(f"ABORTED: '{name}' matched {n} times (expected 1). Nothing written.")
    text = text.replace(old, new)
path.write_text(text, encoding="utf-8")
print(f"Applied {len(EDITS)} fixes to {path}")
