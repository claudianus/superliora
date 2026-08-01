---
'@superliora/liora': patch
---

Prevent shell-run and swarm cards from scheduling another frame inside render, which could busy-loop the TUI when those cards are visible during scroll or ambient ticks.
