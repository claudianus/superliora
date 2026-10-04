---
"@superliora/liora": minor
---

Retire file rewind and the AI-attribution markers in /blame, which stopped working once the agent began editing files only through Bash. /rewind now prints git rollback guidance instead of restoring files, and /blame shows plain git blame.
