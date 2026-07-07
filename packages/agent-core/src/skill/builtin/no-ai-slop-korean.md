---
name: no-ai-slop-korean
description: Korean locale anti-slop voice lanes (discovered via SearchSkill — not a default for all users). Use when SearchSkill returns this skill for Korean UX microcopy, institutional copy, or Korean docs/replies.
---

# No AI Slop — Korean Locale (one of many locale skills)

Apply only when the **locked response language is Korean** and SearchSkill selected this skill. For other languages, SearchSkill for a locale-specific anti-slop skill instead.

## Lane A — Product UX microcopy (해요체)

- Friendly **해요체**, active wording, short sentences.
- **Positive-first recovery** — say what to do next, not only what failed.
- **Specific CTAs** — button/link text names the action ("저장하기", "다시 시도하기").
- Exception-aware wording for legal, policy, privacy, destructive actions.
- Avoid: "~하십시오" overload, "~의 역할을 합니다", "~을 통해 ~할 수 있습니다", "~하고자 합니다", machine-translated English idioms.

## Lane B — Institutional / corporate (합니다/습니다)

- Formal **합니다/습니다** endings.
- **Proof before emotion** — lead with fact, scope, or policy basis.
- Concrete domain → wider public meaning; **future-facing continuity** where relevant.
- Public-interest credibility; no hype adjectives without evidence.

## Translation slop — replace on sight

| Pattern | Prefer |
| --- | --- |
| ~의/하는 역할을 합니다 | ~합니다 / ~을 제공합니다 |
| ~을/를 통해 | ~으로 / ~로 |
| ~을/를 활용하여 | ~하여 / ~로 |
| ~하고자 합니다 | ~하겠습니다 / ~합니다 |
| ~임을 알 수 있습니다 | ~입니다 |
| ~것으로 보입니다/예상됩니다 | ~입니다 (or cite evidence) |
| 그럼에도 불구하고 | 하지만 / 그래도 |

## Workflow

1. Classify surface: UX microcopy vs institutional vs technical docs.
2. Draft in the chosen lane.
3. Self-audit for translation calques and English-style contrast framing.
4. Second pass — read aloud; fix anything that sounds like translated marketing copy.

Style references (JoongAng/Toss-inspired analysis) are **inputs only** — do not copy passages or claim affiliation.
