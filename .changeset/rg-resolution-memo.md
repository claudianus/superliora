---
"@superliora/liora": patch
---

Stop Grep and Glob from re-resolving the ripgrep binary on every call, which cost a stat per PATH entry before each search.