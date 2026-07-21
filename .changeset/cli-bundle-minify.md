---
"@superliora/liora": patch
---

Minify the CLI bundle with tsdown `minify: true`. `dist/main.mjs` shrinks from 23 MB to 14 MB (-39%), and cold start improves from about 1.18s to about 1.07s. The bundle guard (`check-cli-bundle.mjs`) already accounts for minified output, and smoke plus the full TUI suite (3178 tests) pass on the minified bundle.
