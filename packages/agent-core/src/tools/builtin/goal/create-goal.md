Create a durable, structured goal that the runtime will pursue across multiple turns.

Call only when the user explicitly starts a goal/autonomous outcome. Do NOT create goals for greetings, ordinary questions, or vague requests lacking a verifiable completion condition.

If vague, ask for the missing completion criterion first. Include `completionCriterion` when provided or stateable. Keep `objective` concise; reference long task text by path.

Fails if a goal already exists — `replace: true` only when the user explicitly abandons the current goal.
