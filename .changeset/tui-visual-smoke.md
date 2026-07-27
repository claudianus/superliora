---
"@superliora/liora": minor
---

Add a real-surface visual smoke for the TUI. `pnpm -C apps/liora run smoke:visual` spawns the built CLI under node-pty at 120x32, drives a short input scenario (type, Ctrl-C sequence), and asserts the live chrome renders: the welcome screen, the echoed input, and substantial frame output. Raw ANSI plus stripped-text snapshots land in `.superliora/visual-smoke/` for hand-diffing regressions. Note: node-pty's prebuilt `spawn-helper` can lose its executable bit after install — `chmod +x` it under `node_modules/.pnpm/node-pty@*/…/prebuilds/darwin-*/` if the smoke reports `posix_spawnp failed`.
