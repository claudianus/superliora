---
"@superliora/liora": minor
---

Add a Script tool: the agent writes one JavaScript snippet that calls read/write/glob/exec/agent as functions and processes results in code, so bulk work no longer costs one model round-trip per item or floods the context with raw output. The script context persists per session (a `store` object carries state across calls), and `agent(prompt)` enables programmatic subagent fan-out with `Promise.all` on the main agent. Available in the agent, full, coder, and goal-driver profiles.
