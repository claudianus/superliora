Ask the user questions with structured options — preferences, ambiguous requirements, or concrete approach choices.

**Do not use when:** you can infer the answer, or the decision is trivial and does not change next action. Overuse breaks flow.

**Usage:**
- Users always have "Other" for free text — do not invent that option
- `multi_select` for multi-answer; labels 1–5 words; trade-offs in descriptions
- Scope/quality: Baseline (original intent) + Upgrades (clear payoff)
- Prefer 2–4 options; single option only for explicit confirmation
- Open-ended: omit `options` so "Other" captures free text; 1–4 related questions/call
- Recommended option first with "(Recommended)" on the label
- Result `answers` keyed by question; empty `answers` + dismiss `note` means declined — use best judgment; do not re-ask
