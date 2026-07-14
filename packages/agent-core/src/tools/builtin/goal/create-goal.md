Create a durable, structured goal that the runtime will pursue across multiple turns.

Call `CreateGoal` only when:
- the user explicitly asks to start a goal or work autonomously toward an outcome, or
- a host goal-intake prompt asks you to create one.

Do NOT create a goal for greetings, ordinary questions, or vague requests that lack a verifiable completion condition. A goal needs a checkable end state.

When the request is vague, ask for the missing completion criterion first. If the user insists after you warn that the wording is vague or risky, create the goal.

Include `completionCriterion` when the user provides one, or when it can be stated without inventing requirements. Keep `objective` concise; reference long task text by file path.

Creating a goal fails if one already exists — use `replace: true` only when the user explicitly wants to abandon the current goal and start a new one.
