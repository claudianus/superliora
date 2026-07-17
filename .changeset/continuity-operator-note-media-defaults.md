---
"@superliora/agent-core": minor
"@superliora/sdk": patch
"@superliora/liora": patch
---

**Long-session continuity + media zero-config defaults**

- Context OS injections include a Continuity operator note when pages need rehydration, are at_risk, or are missing durable evidence IDs (`formatContinuityOperatorNote`).
- Media readiness seed/source checks lock GenerateImage default size **1024x1024** / provider auto and GenerateVideo **16:9 · 5s**.
- New holdout `long-session-continuity` source-gates reclaim ladder + missing-ev footer badge + injection budget.
