---
name: avoid-ai-writing
description: Audit and rewrite content to remove AI writing patterns (AI-isms). Use when asked to remove AI slop, clean up AI writing, edit docs/PR/changelog/replies, or make text sound human. Supports detect-only, rewrite, and edit-in-place modes with a second-pass self-audit.
---

# Avoid AI Writing — Audit & Rewrite

Pattern checks for machine-like prose. **Signals, not proof** — never use detector scores to accuse an author.

## Modes

- **rewrite** (default): flag issues → rewrite → diff summary → **second-pass audit** on the rewrite.
- **detect**: flag only; no edits.
- **edit**: minimal in-place edits via Edit tool; skip quoted/code blocks; re-read after.

Trigger detect with "flag only", "audit only", "scan". Trigger edit when a file path is named.

## Workflow (rewrite)

1. Quote each flagged span with category.
2. Rewrite with plain verbs, varied sentence length, concrete facts.
3. Summarize what changed.
4. **Second-pass audit** — re-read the rewrite; fix surviving tells (max 2 passes total).

## Tier 1 — always replace

| Replace | With |
| --- | --- |
| delve | explore, look at |
| leverage / utilize | use |
| robust | reliable, solid |
| streamline | simplify, speed up |
| pivotal | important, key |
| cutting-edge | latest, modern |
| landscape (metaphor) | field, area |
| testament to | shows, proves |
| foster | encourage, support |
| underscore | highlight, show |
| realm | field, area |
| meticulous | careful, detailed |
| comprehensive | complete, full |
| embark | start, begin |
| seamless | smooth, easy |
| bespoke | custom |
| game-changer | (say what changed) |
| revolutionary / transformative | (describe the change) |
| dynamic (hype) | (cut or be specific) |
| holistic / actionable / impactful | (name what's included / what happened) |
| delve into / deep dive / unpack | look at, explain, break down |
| in order to | to |
| serves as | is |
| due to the fact that | because |

## Tier 2 — flag when 2+ in one paragraph

elevate, navigate, harness, unleash, empower, bolster, spearhead, resonate, revolutionize, facilitate, nuanced, crucial, ecosystem (metaphor), myriad, plethora, catalyze, reimagine, cornerstone, paramount, burgeoning, nascent.

## Structure & formatting

- **No template intros**: "In today's rapidly evolving…", "It is worth noting…", "Moreover/Furthermore/Additionally" chains.
- **No template outros**: "In conclusion…", "To sum up…", "Ultimately…", "Only time will tell."
- **No contrastive negation framing**: "It's not X, it's Y" / split-sentence variants.
- **No rule-of-three compulsion** — vary list lengths.
- **No bold-inline-header bullet essays** — use prose; lists only for real enumerations.
- **Em dashes**: prefer commas or two sentences; max one per ~1000 words.
- **Cut hedging**: "perhaps", "could potentially", "it's important to note", "to be clear" (when filler).

## Korean (when this locale skill is loaded)

SearchSkill may return a locale skill for the response language — use it for voice lanes. Quick Korean calque fixes when this skill applies: avoid "~의 역할을 합니다" → "~합니다"; "~을 통해" → "~으로"; "~을 활용하여" → "~하여".

## Harness integration

- Run `pnpm run check:slop` on changesets/staged markdown when editing repo docs.
- Runtime may apply deterministic `unslopText` — still reread for meaning drift.
- AGENTS.md and harness contracts override this skill on conflict.
