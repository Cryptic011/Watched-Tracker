# Changelog

## 2026-10-03

### Verified fixes
- Added the supplied scripts/apply_fixes.py source-fix script to the repository and wired it into the GitHub Pages deployment workflow.
- Applied and verified four fixes to index.html:
  - allow pinch-zoom by removing the viewport restriction;
  - preserve episode progress when a season's aired-episode count is unavailable;
  - make cloud-library timestamp ties deterministic in favour of the existing comparison rule;
  - allow the editor modal to use dvh so it is not clipped by the Safari toolbar.
- The deployment workflow now runs the fix script before application and browser checks, so the supplied fixes remain part of the reproducible deployment path.
