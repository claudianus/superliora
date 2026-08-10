---
"@superliora/liora": minor
---

Conductor Jobs declare `surface_kind` (none/web/tui/mixed) and stamp `verifyVerdict` for merge proof. Path regex no longer invents VerifySurface gates, UI sticky mutation tips, or file:// auto-verify; docs/json-only static sets no longer stamp all checks green. Set `surface_kind` on JobCreate; JobSteer can patch it when MergeJob holds.
