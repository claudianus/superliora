Set a hard budget limit for the current goal.

Use only when the user clearly gives a runtime limit, e.g. "stop after 20 turns", "use no more than 500k tokens", "finish within 30 minutes".

Do not invent limits or call on vague wording ("spend some time", "try to be quick").

Compound times convert to one unit first ("2 hours and 3 minutes" → `value: 123, unit: "minutes"`).

Time budgets: 1 second–24 hours (outside rejected). Turn and token budgets need only be positive and are rounded to the nearest whole number (minimum 1).

Units: `turns`, `tokens`, `milliseconds`, `seconds`, `minutes`, `hours`.