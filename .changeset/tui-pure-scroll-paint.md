---
"@superliora/liora": patch
---

Stop a short transcript from blanking to placeholder rows on scroll frames that follow an animation tick, and drop the per-row work the compositor did on frames where reuse is disabled.