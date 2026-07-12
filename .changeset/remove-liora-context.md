---
'@superliora/liora': major
'@superliora/agent-core': major
---

Remove the `LioraContext` harness tool

`LioraContext` frequently blocked turns for 30+ minutes while building or querying the lean-context index. It is now completely removed.

- Deleted `LioraContextTool` and its dedicated compose/cache/render pipeline.
- Removed `LioraContext` from all default profiles (`agent`, `coder`, `explore`, `plan`) and from `system.md`.
- Updated plan-mode guard/tool-read-only lists and lean-context guidance to no longer reference `LioraContext`.
- Removed or updated tests that expected `LioraContext` to be available.
- Remaining lean context tools (`LioraRead`, `LioraSymbol`, `LioraCallgraph`, `LioraTree`, `LioraExpand`) are still available and continue to use the SQLite/tree-sitter index.
