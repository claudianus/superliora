---
"@superliora/liora": patch
"@harness-kit/tui-renderer": patch
---

Fix several typing-related TUI rendering issues: keep ambient animations running when the renderer drops to minimal quality or degraded health; synchronize cursor-only frames to stop the terminal cursor from blinking or drifting during screen updates; use an explicit render cause for transcript scrolling so virtual scroll repaints correctly; prevent the path-autocomplete list from flashing when a space is typed after a folder-like prefix; and keep the ambient animation ticker running regardless of transcript message count so mode toggles and notices do not freeze the frame loop.
