---
"@superliora/liora": patch
---

Fix the code context index taking minutes to build, and stop context lookups from blocking the agent when the index is cold or broken.

Index builds now wrap all SQLite writes in a single transaction with WAL enabled, so the FTS5 shadow writes commit once instead of fsyncing per row. Auto/warm builds no longer run destructive full rebuilds, which previously deleted rows and left an empty committed index when interrupted. Staleness checks now sample a bounded subset of files instead of re-walking the whole tree on every status check.

When the index is still building, missing, or in failure cooldown, context lookups fall back to direct workspace discovery within a short budget instead of waiting on the build.
