---
"@superliora/liora": minor
---

TUI visual pass: full-line diff backgrounds, streaming follow, and palette-bound highlighting

- Edit/Write diff rows now paint the changed line across the full row (gutter included) instead of hugging the text
- Streaming Edit previews follow the live edit edge (tail window) so the viewport tracks the code being written
- Bash command streaming no longer flickers: the command preview updates in place across argument deltas
- Subagent headers, swarm status labels, and the btw panel gain the pulse/spinner motion states defined in PREMIUM.md
- Shiki highlighting now derives its TextMate theme from the active palette (same role mapping as the cli-highlight fallback), so custom and imported ANSI themes color code consistently; theme switches re-bind live
