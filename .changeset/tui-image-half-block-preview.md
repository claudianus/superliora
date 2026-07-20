---
'@superliora/liora': minor
---

Pasted images now render as inline truecolor half-block previews in the transcript on every terminal. Previously kitty/iTerm2 inline-image escapes were emitted raw and displayed as garbled text because the cell compositor only understands SGR and OSC-8. Non-PNG or undecodable attachments keep the text marker.
