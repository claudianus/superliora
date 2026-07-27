---
"@superliora/agent-core": minor
---

Route LioraRead auto mode to full bodies for non-code text (harness reform T1-3). Signature compression only makes sense for code, so `.md/.log/.txt/.json/.yaml/.toml` (and friends) now render full when no explicit mode is given, instead of returning a useless "API surface" for docs and logs. Explicit `mode`/`raw` still win.
