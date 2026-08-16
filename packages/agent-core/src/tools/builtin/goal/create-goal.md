Create a durable, structured goal that the runtime will pursue across multiple turns.

Call only when the user explicitly starts a goal/autonomous outcome — slash `/goal`, or a completion-shaped request such as "keep going until X" / "완료될 때까지". Do NOT create goals for greetings, ordinary questions, one-shot implement/explore, or vague requests lacking a verifiable completion condition. If the ask is a normal Job, use JobCreate(kind=implement|explore) instead. If it is unclear whether they want a Goal Desk loop, ask once with AskUserQuestion.

On Conductor this opens Session Goal Desk + a goal-driver child (same path as `/goal`). Do not JobCreate(kind=goal-desk) or JobCreate(kind=goal-driver) as a substitute — those skip the session binding, Goal Monitor, and `/goal` pause/resume/cancel.

If vague, ask for the missing completion criterion first. Include `completionCriterion` when provided or stateable. Keep `objective` concise; reference long task text by path.

When the user names a verification command (tests, typecheck, lint), set `gateCommand` — completion is then mechanically rejected until that command exits 0, so the loop cannot declare done early.

Fails if a goal already exists — `replace: true` only when the user explicitly abandons the current goal.
