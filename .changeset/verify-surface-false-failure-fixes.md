---
"@superliora/agent-core": patch
"@superliora/liora": patch
---

Fix VerifySurface false-failure verdicts that stalled successful UI work: the craft audit no longer flags accessibility attribute notation (`href="#"` SPA anchors, form `placeholder=` attributes) as placeholder copy and no longer rejects todo-app product copy (visible `TODO:` markers still fail); surfaces without any clickable affordance (canvas/visual UI) mark the interaction axis `not_applicable` instead of failing, and the default smoke click avoids destructive targets (delete/logout/checkout); console noise the product does not own (favicon 404s, browser-extension origins) is filtered from the load axis, and cumulative console re-reads are deduplicated so a pre-existing console error no longer fakes an interaction regression; the fail-fast budget is raised to 240s to cover cold browser-use installs. Merge gates accept `not_applicable` interaction/craft axes while `visual=not_applicable` on a declared web surface still blocks.
