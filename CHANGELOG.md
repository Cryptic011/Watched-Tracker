# Changelog

## 2026-10-03

### Verified fixes
- Connected the existing root `apply_fixes.py` on `main` to the GitHub Pages deployment workflow.
- The fix script now targets the repository's current split source files rather than assuming all code is inside `index.html`.
- Allow pinch-to-zoom by removing the `user-scalable=no` viewport restriction.
- Preserve episode progress when release/episode metadata for the current season is unavailable instead of clamping progress to zero.
- Make `mergeLibraries` timestamp ties deterministic so the first/cloud record wins an equal-timestamp collision.
- Add `90dvh` to the editor modal height so Safari's dynamic toolbar does not clip the modal.
- The script is idempotent and verifies all four fixes on every deployment.
