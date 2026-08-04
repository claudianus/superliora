Enter plan mode before non-trivial implementation to get user sign-off.

## When to enter (either kind)

Use when ANY apply: new feature, multiple valid approaches, architectural/multi-file changes (3+ files), or unclear requirements that materially change the approach.

When NOT to use: tiny fixes, very specific instructions, or pure exploration — just implement via JobCreate / tools.

## Regular vs Ultra — pick with `ultra` (or omit to auto-route)

| Kind | Set | Use when ALL of these fit |
|---|---|---|
| **Regular** | `ultra: false` (or omit when context is scoped) | Scope is mostly decided; 1–3 concrete files/paths; fix/add/adjust with clear success; user does not need a Socratic requirements interview |
| **Ultra** | `ultra: true` (or omit when context is vague/high-stakes) | Vague / greenfield / “build me X”; multiple valid architectures; need verifiable UltraGoal + Seed Spec / AC Tree; ambiguity must drop before code (Ouroboros-style, ambiguity ≤ 0.2) |

**Auto-route when `ultra` is omitted:** scored from `initial_context` (greenfield / vague / long open brief → ultra; path-scoped fix → regular). Pass `ultra` explicitly when the score would be wrong. Always pass `initial_context` with the user task text.

**Ultra pipeline (worker):** optional research → Socratic interview (Seed) → optional design/review → write plan → ExitPlanMode. Prefer `NextPhase({ phase: 'write' })` from interview once the UltraGoal is verifiable (skip design/review unless architecture is still open).

**Conductor (Plan Desk):** Does not run the phase engine on the interactive lane. Creates a mission Job (regular or ultra per routing) and ACKs. Stay free — JobInbox / JobSteer; no NextPhase/Write here.

**Non-Conductor:** Enters plan mode on this agent. Structured plan uses NextPhase; free-form writes the plan file then ExitPlanMode.
