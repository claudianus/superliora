Request plan approval after writing the plan to the plan file. This tool does NOT take the plan content as a parameter — it reads the file you wrote.

Use only for implementation planning, not for research tasks (searching/reading the codebase).

A good plan lists verifiable steps with real files and commands. For Ultra Plan include:
`Swarm decision: ENGAGE|ADAPTIVE|DEFER - <reason>; Swarm intensity: light|standard|heavy; value: <specialist value or none>; owner: <verification owner>`

Multiple approaches: pass them via the `options` parameter so the user can choose (see parameter format) alongside Reject and Revise controls.

Before calling: in auto mode decide without AskUserQuestion; in yolo/manual resolve questions first — not AskUserQuestion for "is this plan OK?". If rejected, revise based on feedback and call again.
