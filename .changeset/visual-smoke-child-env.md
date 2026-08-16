---
"@superliora/liora": patch
---

Make `smoke:visual` paint reliably under muted parent shells. The harness no longer inherits `NO_COLOR` / `FORCE_COLOR=0` / `TERM=dumb`, pins `TERM=xterm-256color` + `COLORTERM=truecolor`, and sets `SUPERLIORA_IMAGE_PROTOCOL=none` so kitty graphics probes do not dump `Gi=31` into the captured frame.
