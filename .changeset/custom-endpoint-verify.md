---
"@superliora/liora": patch
---

Verify custom endpoints before saving: rejected keys block the save with a clear message, while offline servers and non-OpenAI wires still save with a warning. Also add a headers field and max-output field to the dialog, matching the CLI flags.
