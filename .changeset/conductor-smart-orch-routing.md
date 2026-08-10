---
"@superliora/liora": minor
---

Smart Auto on the Conductor lane now picks a coding-class orchestrator from models.dev scores instead of classifying the user prompt into completion/Grok. Conductor can set JobCreate.model_alias from the injected fleet catalog when role models are auto; pinned workers fail over through that alias's fallbackModels first, and model failures surface a next_hint on the Job desk. Use `/model auto` with the Conductor profile; pass `model_alias` on JobCreate to staff workers.
