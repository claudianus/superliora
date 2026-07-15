Set a hard budget limit for the current goal.

Use only when the user clearly gives a runtime limit, such as:
- "stop after 20 turns"
- "use no more than 500k tokens"
- "finish within 30 minutes"

Do not invent limits. Do not call for vague wording like "spend some time" or "try to be quick".

If the user gives a compound time, convert to one supported unit first (e.g. "2 hours and 3 minutes" → `value: 123, unit: "minutes"`).

A time budget must be between 1 second and 24 hours — shorter/longer values are rejected as not a reasonable goal budget. Turn and token budgets need only be positive and are rounded to the nearest whole number (minimum 1).

Supported units: `turns`, `tokens`, `milliseconds`, `seconds`, `minutes`, `hours`.
