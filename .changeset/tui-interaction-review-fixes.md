---
"@superliora/liora": patch
---

Fix hangul, emoji, and other multi-codepoint input being silently dropped from searchable lists and the Command Hub, and make Enter submit the prompt on terminals that send LF or CSI-u enter sequences.

Escape inside the approval feedback editor now cancels the draft instead of rejecting the tool call, and Escape inside a question dialog's Other field leaves the field instead of discarding every answered tab. Shift+Tab moves back one question tab.

Approvals and questions that arrive while another dialog is open now raise their attention notification instead of waiting silently, Ctrl+C closes read-only panels (help, blame, file viewer, task browser) so it can interrupt a streaming turn, and slash-command completion recognizes fullwidth spaces. `@` file-mention completion no longer blocks keystrokes while walking the workspace without fd. Truncation of tool and plugin descriptions is now display-width aware for CJK text.
