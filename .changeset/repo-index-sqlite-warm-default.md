---
"@superliora/liora": patch
---

RepoIndex now defaults to the bundled SQLite FTS engine and warms the codemap at session start. Opt out with `SUPERLIORA_REPO_INDEX_ENGINE=stub` or `zoekt`, and `SUPERLIORA_REPO_INDEX_WARM=0`.
