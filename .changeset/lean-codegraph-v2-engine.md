---
"@superliora/liora": minor
---

Replace the lean context JSON index with a SQLite code graph (tree-sitter + FTS5) so LioraIndex builds and LioraContext compose stay fast on large workspaces. Run `LioraIndex action=build` once, then use `LioraContext` compose as usual.
