---
name: no-ai-slop
description: SuperLiora no-AI-slop harness router. Light pass by default; SearchSkill with response language + surface when shipping user-visible prose. Not a bottleneck for code-only turns.
---

# No AI Slop — Harness Skill

See `packages/agent-core/src/skill/builtin/no-ai-slop.md` for the full router. Summary:

1. **Skip** for code, tool output, one-line replies.
2. **Light pass** (system.md) for most answers.
3. **SearchSkill → Skill** only when shipping docs, PR/changelog, TUI copy, plans, or long prose — include **response language** in keywords.
4. Load the best match; do not hardcode locale skills.

Related: `.agents/skills/gen-changesets`, `sync-changelog`, `write-tui`.
