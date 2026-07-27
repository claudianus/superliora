---
"@superliora/liora": minor
---

Retire the legacy lean-context indexing subsystem (tree-sitter WASM parser, flag-gated graph index, lean injector/postprocessor) and replace it with CodeMap: an oxc-based symbol index with a sqlite store and content-hash incremental updates. LioraSymbol now queries the CodeMap index first with the regex path as fallback; LioraCallgraph runs its direct-scan path only; compaction keeps its density scoring via a moved pure module. Six tree-sitter packages are dropped from agent-core.
