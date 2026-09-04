---
"@superliora/liora": patch
---

Fix Command Hub entries that advertised actions the dispatcher would reject: mid-turn Undo/Compact rows now explain that they run after the turn instead of dispatching into a guaranteed error, Retry says why it is blocked instead of silently doing nothing, and Stop reports a failed cancel. The Hub search now also finds primary and diagnostic slash commands, not just advanced ones, and the queue hints and step-interrupted messages are localized.
