---
"@superliora/liora": patch
---

Keep the built-in syntax check when a language server is configured. It was previously skipped whenever a plugin language server was present, but the server declines a file it does not handle and stays silent after a failed spawn, so a TypeScript-only setup left a broken Python or JavaScript edit with no diagnostic at all — worse than having no language server, where the check does run. The parse now also runs when the server declines, and its output is used only when the server has nothing to report.
