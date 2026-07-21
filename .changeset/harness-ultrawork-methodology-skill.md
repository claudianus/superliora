---
'@superliora/agent-core': minor
'@superliora/liora': minor
---

Move the Ultrawork methodology from the activation prompt into a builtin skill

- Add an `ultrawork` builtin skill (registered through `registerBuiltinSkills`, loadable via the Skill tool) carrying the full workflow methodology: stage spine, research/interview rules, plan artifacts, swarm decision format, evidence ledger, core operating rules, and the GUI/bench capability sections.
- `/ultrawork` activation now injects a lean contract (under 3 KB, was ~7.5 KB): objective-as-data handling, a pointer to load the `ultrawork` skill first, the stage spine with advisory checkpoints, runtime evidence-seed paths, and conditional one-line capability pointers. Phase guidance stays advisory; safety policies are unchanged.
- The agent pulls the methodology on demand instead of paying the injection cost on every activation; nothing is removed, only relocated.
