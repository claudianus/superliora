---
"@superliora/agent-core": minor
---

Gate the reminder stack on non-visual sessions: the TodoList nag now counts only mutating tool calls (read-only exploration no longer advances the threshold), and the tool-workflow reminder stays a sparse checkpoint after real user prompts instead of re-dumping the full contract that the system prompt already carries
