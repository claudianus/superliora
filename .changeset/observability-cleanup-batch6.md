---
"@superliora/liora": patch
---

Remove leftover per-call debug logging from the session-client registry, stop the subagent task-id fallback from bailing out on duplicate descriptions (which skipped terminal-status dedup and produced duplicate transcript entries), document the volatile-event/tracker invariant, broaden the evidence-text secret redaction to cover AWS keys, JWTs, and bearer tokens, and route the Ultrawork auto-resume notice through the i18n catalog instead of hardcoding Korean.
