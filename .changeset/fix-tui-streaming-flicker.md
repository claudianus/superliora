---
"@harness-kit/tui-renderer": patch
"@superliora/liora": patch
---

Fix heavy TUI flickering on Windows terminals while the agent is streaming or working: pace frame updates on terminals that cannot repaint atomically, batch streaming text instead of redrawing on every chunk, and snap the type-on reveal into place instead of animating it.
