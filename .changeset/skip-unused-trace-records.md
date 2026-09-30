---
"@superliora/liora": patch
---

Stop the terminal renderer from building a trace record on every frame when no trace is being read. The recorder defaults to enabled and the TUI does not pass a trace option, so a thousand-event ring buffer of per-frame metrics was being filled on the render hot path for a diagnostic that nothing exports — pure allocation churn that grew the heap while the TUI sat idle. Recording is unchanged whenever a trace is actually configured, and tracing stays on by default; only the unused work is skipped.
