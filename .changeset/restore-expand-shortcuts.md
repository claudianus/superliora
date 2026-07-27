---
"@superliora/liora": minor
---

Restore the Ctrl-O and Ctrl-T shortcuts in the native TUI. The Command Hub rework dropped their key handling but left every footer hint ("ctrl+o to expand", "ctrl+t to expand") and the help strings in place, so the advertised shortcuts silently did nothing. Ctrl-O again toggles tool output / reasoning expansion and Ctrl-T expands or collapses the todo list (consumed only while the panel overflows). Both bindings are re-listed in the keymap single source, so the Hub cheatsheet and /help match the footers again.
