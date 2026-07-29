Enter plan mode before non-trivial implementation to get user sign-off.

Use when ANY apply: new feature, multiple valid approaches, architectural/multi-file changes (3+ files), or unclear requirements that materially change the approach.

When NOT to use: tiny fixes, very specific instructions, or pure exploration.

Permission: enters without approval; ExitPlanMode shows plan in yolo/manual; auto skips AskUserQuestion on exit. Do not enter while plan mode is active; in Ultra Plan use NextPhase. Once active, a runtime reminder enforces read-only workflow.
