---
name: no-ai-slop
description: Router for SuperLiora no-AI-slop harness skills. Use when user-facing prose needs a quality pass — not for code-only turns. SearchSkill with response language + surface keywords; load avoid-ai-writing or the best locale/UI/changelog match.
---

# No AI Slop — Harness Router

Quality gate for user-facing prose — **not a bottleneck** on code, tools, or short replies.

## When to apply

| Apply | Skip |
| --- | --- |
| Docs, PR/changelog, TUI copy, plans, benchmark reports | Code, commands, paths, tool logs |
| Long answers with marketing/doc tone | One-line confirmations |
| UI/copy briefs | Light pass (system.md) is enough |

## Dynamic routing (SearchSkill → Skill)

Include **response language** + **surface** in English keywords:

| Surface | Example SearchSkill query |
| --- | --- |
| General audit | `avoid ai writing anti slop` + language |
| Locale / UX voice | `anti slop locale voice UX copy` + language |
| UI / visual | `anti slop ui design` |
| Changelog / PR | `anti slop changelog pr` |
| Meta-prompt / brief | `anti slop meta prompt CRISP` |

Load the best hit via `Skill`. Prefer `avoid-ai-writing` for language-agnostic audit. **Locale skills are discovered** — never assume Korean or any default language.

## Workflow

1. **Light pass** — system.md rules + 5-second buzzword scan (default).
2. **Skill load** — only if shipping prose and light pass is insufficient.
3. **Self-audit** — pattern checks; detectors advisory only.
4. **Second pass** — only when meaning is preserved; skip if it flattens voice.

## Builtin skills (examples — SearchSkill finds the right one)

- `avoid-ai-writing` — prose audit / rewrite
- `no-ai-slop-ui` — visual anti-slop
- `no-ai-slop-changelog` — release / PR text
- `no-ai-slop-meta-prompt` — structured briefs
- Locale skills (e.g. `no-ai-slop-korean`) — when SearchSkill returns them for the target language
