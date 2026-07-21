---
'@superliora/agent-core': patch
---

Repair stale agent-core test mocks and wire Moonshot `custom_headers` into web search

- Wire `services.moonshot_search.custom_headers` from config.toml through `ResearchSearchEngine` into `MoonshotWebSearchProvider`; configured headers were parsed but silently dropped.
- Update stale test mocks to the current Agent contract: `ultraworkObjectiveProfile` cache (premium density), `ultrawork.getRun()` (EnterPlanMode), `telemetry.track` (Ultrawork stage changes).
- Align AskUserQuestion tests with the intended mode contract: auto-answer only in `auto` mode; `yolo` still asks the human.
- Refresh `autoDream: null` status-event snapshots, the evidence-root workflow-report write matcher, and the regenerated expert-catalog persona wording.
