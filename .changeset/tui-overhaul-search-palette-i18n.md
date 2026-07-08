---
"@superliora/liora": minor
---

Add interactive search and retry features to the TUI: Ctrl-R searches input history, Ctrl-Space opens a command palette, Ctrl-F searches the transcript, and Ctrl-Y (or `/retry`) resends the last message after a failed turn.

Fix a render crash in list pickers when a selected option had a description but no explicit tone.

Fix terminal not being restored after SIGHUP or a dead pty, and clear several leaked timers (footer goal clock, tasks-browser poll, goal-promotion, detach hint) on exit.

Defer background approval/question panels while a command dialog is open so the in-flight flow is not clobbered.

Surface session-fetch failures instead of showing an empty list silently.

Pass the abort signal through to browser-based OAuth flows so cancellation takes effect.

Add Korean (ko) localization for TUI status strings, hints, provider/login flows, and the new search/palette/retry dialogs, driven by the existing `SUPERLIORA_LOCALE` / `LANG` locale detection.
