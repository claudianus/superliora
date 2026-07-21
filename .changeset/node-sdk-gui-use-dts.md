---
'@superliora/sdk': patch
---

Include `@superliora/gui-use` in the `build:dts` rollup pipeline (tsc include list, workspace specifier rewrite, api-extractor `bundledPackages`) so the SDK browser-use re-exports produce a valid `dist/index.d.mts`.
