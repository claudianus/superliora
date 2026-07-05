---
"@superliora/liora": patch
---

Restore full-screen terminal occupation so scrolling stays inside the chat and never escapes into the shell's previous output. The terminal UI now uses the alternate screen buffer and captures scroll, mouse, and enhanced keyboard input directly, which also makes the in-app virtual scroll respond to PageUp/PageDown and mouse wheel.
