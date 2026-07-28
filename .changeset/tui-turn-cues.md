---
'@superliora/liora': minor
---

Make turn boundaries visible in the TUI transcript and surface step retries: a new turn's first assistant block gets a brief (~300ms) highlight settle on its first visible line and the turn's last block settles its final line on completion (shared animation clock, byte-stable once settled, static under off/SSH/NO_COLOR/CI), and `turn.step.retrying` events now print a transient warning status line with the attempt count, error, and backoff delay instead of being dropped silently.
