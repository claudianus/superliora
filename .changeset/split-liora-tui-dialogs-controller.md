---
"@superliora/liora": patch
---

Split the dialog-mounting shell (editor-replacement / center-modal mechanics, session-loading overlay, prompt stash) and the Command Hub, command palette, history search, and transcript search entry points out of the TUI coordinator into their own controller. No behavior change.
