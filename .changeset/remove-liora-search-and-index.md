---
'@superliora/liora': major
'@superliora/agent-core': major
---

Remove the `LioraSearch` and `LioraIndex` harness tools

`LioraSearch` and `LioraIndex` frequently blocked turns for 30+ minutes while building or querying the lean-context index. They are now completely removed.

- Deleted `LioraSearchTool` and `LioraIndexTool`, plus their dedicated `ensureWorkspaceIndex`, `queryIndexedPaths`, and warm-up code paths.
- Removed `LioraSearch` and `LioraIndex` from all default profiles (`agent`, `coder`, `explore`, `plan`, `full`) and from the lean-context system reminder.
- Replaced model-facing guidance that preferred `LioraSearch` with guidance to use `Grep` first.
- Updated `LioraCallgraph` and `LioraExpand` descriptions to no longer reference `LioraSearch`.
- Removed or updated tests that expected `LioraSearch`/`LioraIndex` to be available.
- The remaining `LioraRead`, `LioraSymbol`, `LioraCallgraph`, `LioraTree`, and `LioraExpand` tools continue to use the SQLite/tree-sitter index via `ensureWorkspaceIndexBudgeted`.
