Ask the user structured questions during execution—preferences, ambiguities, or approach choices.

**Do not use when** you can infer the answer or the decision is trivial and does not change the next action.

**Usage:**
- Users always have free-text "Other"—do not invent that option.
- `multi_select` when multiple answers apply.
- Labels 1–5 words; trade-offs in descriptions.
- Prefer 2–4 distinct options; single option only for explicit confirmation.
- Open-ended: omit `options` so "Other" captures free text.
- 1–4 related questions per call; put the recommended option first with "(Recommended)".
- Result `answers` keyed by question. Empty `answers` + dismiss note means declined—proceed with best judgment; do not re-ask the same question.