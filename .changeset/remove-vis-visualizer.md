---
'@superliora/liora': patch
---

Remove the unused `apps/vis` session visualizer and its build plumbing.

`liora vis` was a ghost subcommand (registered nowhere), so the app, its
`@superliora/vis-server` / `@superliora/vis-web` workspace packages, the
`build-vis-asset` prebuild step, the embedded web asset stub, and the vis
typecheck CI steps are gone. No shipped CLI surface changes; builds get
faster by dropping the vis asset generation from `prebuild`.
