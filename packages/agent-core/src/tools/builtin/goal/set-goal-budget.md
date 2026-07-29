Set a hard budget limit for the current goal.

Use only when the user clearly gives a runtime limit, e.g. "stop after 20 turns", "use no more than 500k tokens", "finish within 30 minutes". Do not invent limits or call on vague wording.

Compound times convert to one unit first ("2 hours and 3 minutes" → `value: 123, unit: "minutes"`). Time budgets: 1 second–24 hours. Turn and token budgets: positive, rounded to nearest whole number (minimum 1).

Units: `turns`, `tokens`, `milliseconds`, `seconds`, `minutes`, `hours`.
