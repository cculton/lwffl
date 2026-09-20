# LWFFL Website Draft Plan (Beginner-Friendly)

This is a practical draft for cleaning up and growing the site without rewriting everything at once.

## 1) Project goals
- Keep the site static and simple to host.
- Make page behavior consistent (shared nav, shared look, shared data patterns).
- Reduce copy/paste so future AI-generated edits are safer.

## 2) Current cleanup done
- Shared nav loader was refactored for clearer structure and safer behavior.
- Added better error handling/fallback when `nav.html` cannot load.
- Fixed duplicate `#nav-placeholder` in `record-book.html`.
- Standardized `nav-loader.js` script tags to use `defer` on pages that load shared nav.

## 3) Conventions to follow going forward
- **One source of truth for nav**: edit `nav.html` only.
- **Keep JS files focused**: one file per page feature (e.g., `head-to-head.js`).
- **Avoid duplicate IDs**: each page should contain unique `id` values.
- **Use `defer` for non-inline scripts** to avoid timing bugs.
- **Prefer constants/functions over repeated literals** (breakpoints, selectors, labels).

## 4) Recommended next milestones
1. Move each page's inline `<script>` into a dedicated `.js` file.
2. Move shared visual tokens (colors, spacing, card shell) into `style.css`.
3. Add a lightweight data validation script for JSON files (shape checks).
4. Add a `README.md` with local dev instructions and page map.

## 5) Definition of done for “v1 cleanup”
- All pages load nav consistently.
- No duplicate IDs.
- No page has more than one large inline script block.
- Shared styles/tokens are centralized.
- Basic smoke test checklist exists and is documented.
