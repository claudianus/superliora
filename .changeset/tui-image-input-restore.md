---
'@superliora/liora': minor
---

Restore TUI image input end-to-end:

- Ctrl+V (Alt+V on Windows) pastes clipboard images again. The binding was lost in the native editor rewrite even though the footer hint still advertised it; when the clipboard holds no image the same key now falls back to a clipboard text paste.
- Files dragged onto the terminal attach as image/video attachments. Terminals deliver drops as pasted path text (iTerm2, Ghostty, WezTerm, Terminal.app, Kitty default mode); dropped paths are detected on paste, media files become `[image #n]` / `[video #n]` placeholders, and non-media files keep their path in the prompt. Ordinary text pastes are untouched.
- Remove the dead Kitty DnD handler, which parsed the wrong escape sequence (OSC 52 instead of Kitty's OSC 72 protocol) and was never wired after the workspace revert.

Attached images expand to `image_url` prompt parts on submit, so they reach vision-capable models; the model capability gate (`image_in`) still applies.
