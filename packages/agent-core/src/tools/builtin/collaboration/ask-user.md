Use this tool when you need to ask the user questions with structured options during execution. This allows you to:
1. Collect user preferences or requirements before proceeding
2. Resolve ambiguous or underspecified instructions
3. Let the user decide between implementation approaches as you work
4. Present concrete options when multiple valid directions exist

**When NOT to use:**
- When you can infer the answer from context — be decisive and proceed
- Trivial decisions that don't materially affect the outcome

Overusing this tool interrupts the user's flow. Only use it when the user's input genuinely changes your next action.

**Usage notes:**
- Users always have an "Other" option for custom input — don't create one yourself
- Use multi_select to allow multiple answers to be selected for a question
- Keep option labels concise (1-5 words), use descriptions for trade-offs and details
- When options represent scope or quality choices, label a Baseline (original intent) and Upgrades (clear payoff); put trade-offs in descriptions
- Each question should usually have 2-4 meaningful, distinct options; use one option only for explicit confirmation
- For open-ended questions, omit `options`; the built-in "Other" answer lets the user type custom text
- You can ask 1-4 questions at a time; group related questions to minimize interruptions
- If you recommend a specific option, list it first and append "(Recommended)" to its label
- The result is JSON with an `answers` object whose keys identify each answered question; if `answers` is empty and a `note` says the user dismissed it, they declined to answer — proceed with your best judgment and do not re-ask the same question
