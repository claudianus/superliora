---
name: no-ai-slop-meta-prompt
description: CRISP and anti-slop meta-prompt patterns for structured generation. Use when writing system prompts, skill briefs, interview options, or any prompt that must avoid generic LLM defaults.
---

# No AI Slop — Meta-Prompt & Brief Patterns

Models default to statistical-average prose. **Structure beats hope.**

## CRISP skeleton

| Letter | Provide |
| --- | --- |
| **C** Context | Audience, what they know, decision stage |
| **R** Role | Expert stance (specific, not "helpful assistant") |
| **I** Instruction | Exact task, POV, argument |
| **S** Structure | Format, sections, length |
| **P** Parameters | Tone, banned phrases, required examples, stop conditions |

## Anti-slop parameters (always include)

- **Banned phrase list** — Tier 1 words from `avoid-ai-writing` plus domain-specific clichés.
- **Negative layout/examples** — one "not approved" snippet beats ten adjectives.
- **Positive examples** — 2–3 approved snippets showing target voice.
- **Self-audit gate** — "Before final output, list any surviving banned patterns; rewrite if found."

## Multi-phase generation

For long-form or high-stakes copy:

```
outline → draft → critique (detect mode) → finalize
```

Do not single-shot complex content. Lower temperature (0–0.3) for production copy; higher only for ideation.

## Concrete negatives beat vague ones

- Bad: "don't be generic"
- Good: "do not use a three-equal-card grid; use 60/40 split with one primary CTA"

## Research hooks

When freshness matters, require source URLs in the brief before generation — pretrained defaults amplify slop.

Load `avoid-ai-writing` for the audit pass after generation.
