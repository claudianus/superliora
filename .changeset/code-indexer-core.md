---
"@superliora/liora": minor
---

Code indexer core (T5-1): oxc-based top-level symbol extraction with a node:sqlite store and content-hash incremental updates. Extract -> persist -> discard keeps memory flat; traversal stays on `git ls-files` and never enters node_modules. Foundation for persistent cross-session code maps behind the Liora tools.
