Enter plan mode before non-trivial implementation to get user sign-off.

Use when ANY apply:
1. New Feature Implementation
2. Multiple Valid Approaches
3. Architectural or multi-file changes (3+ files)
4. Unclear requirements or preferences that materially change the approach

When NOT to use: tiny fixes, very specific instructions, or pure exploration.

Permission: enters without approval in all modes; ExitPlanMode shows plan in yolo/manual; auto skips AskUserQuestion on exit. Do not enter while plan mode is active; in Ultra Plan use NextPhase, never EnterPlanMode(phase). Once active, a runtime reminder enforces read-only workflow. For unknown structure, spawn `Agent(subagent_type="explore")` first when available.
