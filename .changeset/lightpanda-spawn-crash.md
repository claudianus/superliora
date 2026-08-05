---
"@superliora/liora": patch
---

Stop a missing browser binary from killing the CLI. When the Lightpanda executable was absent or not executable, the spawn error arrived asynchronously with no listener attached, so Node escalated it to an uncaught exception and took the whole process down instead of failing the browser launch. Launch and the doctor probe now surface it as an actionable error and fall back as designed.
