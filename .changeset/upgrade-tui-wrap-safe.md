---
"@superliora/liora": patch
---

Fix stale lines piling up in the liora upgrade prompt and progress display when output wraps, repainting frames safely at any terminal width.

Restyle the upgrade prompt, upgrade progress, and install scripts with animated spinners, gradient progress bars, and styled status output; raw stage markers now only appear in piped or CI output.
