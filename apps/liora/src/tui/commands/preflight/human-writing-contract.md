# Human Writing / Anti-Slop

Treat no-AI-slop as a quality gate for user-facing prose — **not a bottleneck on code**, tools, or short confirmations.

## Default

Prefer a **light pass**. Skip for code, tool output, and one-line replies.

## Dynamic routing

When shipping docs, PR/changelog text, TUI copy, plans, or long prose:

1. Include **response language** in SearchSkill keywords.
2. **Locale-specific skills are discovered via SearchSkill** — **never assume a default language**.
3. Load the best **surface-specific voice lane**.

## Voice

- Prefer **plain specific claims, concrete nouns and verbs**.
- Prefer **source-backed details** over filler.
- **self-audit for template openings**.
- Apply **avoid-ai-writing style checks**.

## Detectors

**Do not treat AI-writing detectors as truth.** Use them only as **deterministic unslop cleanup only as advisory pattern checks**. **never use detector signals to accuse an author**. After cleanup, **reread for changed meaning**.
