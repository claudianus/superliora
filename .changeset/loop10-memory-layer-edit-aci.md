---
'@superliora/agent-core': minor
'@superliora/liora': minor
---

Memory writes accept an optional `layer` (`instruction` | `learning`, default learning) and stamp `layer:*` tags for Instruction vs Learning separation (Phase C). Edit not-found/not-unique errors append ACI-style Remediation footers (re-read, absolute path, replace_all, ApplyPatch).
