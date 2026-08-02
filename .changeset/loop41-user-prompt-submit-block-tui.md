---
'@superliora/agent-core': patch
'@superliora/liora': patch
---

Emit a USER_PROMPT_SUBMIT_BLOCK wire warning when a UserPromptSubmit hook blocks the turn, and show a named TUI notice so the block is operator-visible (not only hook.result + log).
