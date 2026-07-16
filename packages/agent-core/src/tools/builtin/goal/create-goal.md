Create a durable, structured goal that the runtime will pursue across multiple turns.

Call `CreateGoal` only when the user explicitly starts a goal/autonomous outcome, or a host goal-intake prompt asks for one.

Do NOT create goals for greetings, ordinary questions, or vague requests that lack a verifiable completion condition.

If vague, ask for the missing completion criterion first. If the user insists after a vagueness/risk warning, create it.

Include `completionCriterion` when provided or stateable without inventing requirements. Keep `objective` concise; reference long task text by path.

Fails if a goal already exists — `replace: true` only when the user explicitly abandons the current goal.