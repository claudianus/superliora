---
"@superliora/liora": minor
"@superliora/agent-core": minor
"@superliora/sdk": minor
"@harness-kit/tui-renderer": minor
---

Add prompt intelligence: inline autocomplete ghost text (Tab to accept) and next-task suggestions when the prompt is empty (↑/↓ to cycle, Tab to fill). Uses a dedicated lightweight model (`loopControl.completionModel`) with thinking off for fast, cost-efficient predictions. Gated by the `prompt_intelligence` experimental flag.
