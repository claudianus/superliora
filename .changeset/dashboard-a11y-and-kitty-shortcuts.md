---
"@superliora/liora": patch
---

Fix keyboard and clipboard gaps the CI ratchet had been hiding. The Agent Dashboard now jumps to either end of the list with Home/End and prints the selected position and group as plain text, so the pointer glyph and colour are no longer the only focus cues. The model-fallback editor (`a`/`d`/`r`) and the extensions modal (`i`) decode Kitty CSI-u input, so those shortcuts work in the VSCode integrated terminal instead of silently doing nothing.
