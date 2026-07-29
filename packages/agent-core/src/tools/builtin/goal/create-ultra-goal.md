Create a structured UltraGoal with loop engineering protocols.

Unlike `CreateGoal` (simple persistence), `CreateUltraGoal` activates a structured loop:

- **closed** mode (default): Evaluator-Optimizer loop. Define 2-5 acceptance criteria, iterate until ALL have passing evidence.
- **open** mode: Self-improvement loop with quality floor + circuit breaker. Runs until user cancels.

Call when: complex features needing structured verification, or continuous improvement without fixed endpoint (open mode). Do NOT call for simple tasks where `CreateGoal` suffices, greetings, or ordinary questions.

Requires user approval before activation.
