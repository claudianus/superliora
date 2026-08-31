---
"@superliora/liora": patch
---

Fix the VerifySurface dead-end on packaged hosts: `browser-use doctor` no longer refuses to probe when no source packageRoot exists, `browser-use install` now repairs the missing cloakbrowser/playwright-core node_modules sidecars next to the installed binary, and the browser runtimes load playwright-core through a disk resolver that walks the documented install roots instead of a bare external import. Also accept explicit `focus: null` in the auto-skillify lesson gate JSON (models emit null, not an absent field).
