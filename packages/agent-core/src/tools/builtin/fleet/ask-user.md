Ask the user questions with structured options — preferences, ambiguous requirements, or approach choices.

**Do not use when:** you can infer the answer, the decision is trivial, or you are renegotiating magnitude ("do you really want this?", "reduce scope?", "too large?"). Goal/auto modes reject those scope-escape questions — keep executing. Overuse breaks flow.

**Usage:**
- Users always have "Other" for free text — do not invent that option
- `multi_select` for multi-answer; labels 1–5 words; trade-offs in descriptions
- Prefer 2–4 options; recommended option first with "(Recommended)"
- Open-ended: omit `options` so "Other" captures free text; 1–4 related questions/call
- Result `answers` keyed by question; empty `answers` + dismiss `note` means declined — use best judgment; do not re-ask
