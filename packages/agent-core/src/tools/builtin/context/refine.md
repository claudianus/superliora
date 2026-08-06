Review the recent trajectory and improve the harness itself: durable prompt notes, long-term memory records, reusable skills, and subagent specs. Every edit is recorded with a snapshot and can be rolled back by id.

Use this when you notice a lesson worth persisting across the session — a convention you discovered, a mistake to avoid repeating, a workflow that worked well, or a delegation pattern worth reusing.

Actions:
- `run` (default): analyze the trajectory and apply small, evidence-backed edits. Pass `instructions` to focus the review. Use `scope: "global"` only for improvements that generalize beyond this workspace.
- `status`: list current harness entries and recent refinements (with ids for rollback).
- `rollback`: revert one applied refinement by `refinementId`.

Prefer `run` after completing a non-trivial task phase, not after every step. Do not refine an empty or trivial trajectory.
