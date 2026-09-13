---
'@superliora/liora': patch
---

Show a notice when the model's reply was cut off by its output token limit, stop agent turns that spin on failing tool calls, and cap turns at a generous 200 steps so unattended runs cannot grind to a context overflow.
