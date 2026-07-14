Use this tool when you need to ask the user questions with structured options during execution — preferences, ambiguous requirements, or concrete choices between approaches.

**When NOT to use:**
- When you can infer the answer from context — be decisive and proceed
- Trivial decisions that don't materially affect the outcome

Overusing this tool interrupts the user's flow. Only use it when the user's input genuinely changes your next action.

**Usage notes:**
- Users always have an "Other" option for custom input — don't create one yourself
- Use multi_select to allow multiple answers for a question
- Keep option labels concise (1-5 words); put trade-offs in descriptions
- For scope/quality choices, label a Baseline (original intent) and Upgrades (clear payoff)
- Prefer 2-4 meaningful, distinct options; use one option only for explicit confirmation
- For open-ended questions, omit `options` so the built-in "Other" answer lets the user type custom text
- Ask 1-4 related questions at a time to minimize interruptions
- If you recommend an option, list it first and append "(Recommended)" to its label
- Result JSON has an `answers` object keyed by question. If `answers` is empty and a `note` says the user dismissed it, they declined — proceed with best judgment and do not re-ask the same question
