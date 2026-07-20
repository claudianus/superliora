Create a structured UltraGoal with loop engineering protocols.

Unlike `CreateGoal` (simple persistence — the model decides its own approach), `CreateUltraGoal` activates a structured loop protocol:

- **closed** mode (default): Evaluator-Optimizer loop. Define 2-5 acceptance criteria first, then iterate until ALL criteria have passing evidence. The verifier is the criteria, not self-assessment.
- **open** mode: Self-improvement loop with quality floor + circuit breaker. Runs indefinitely until the user cancels. Each cycle: observe → improve → verify floor → report.

Call `CreateUltraGoal` when:
- The task benefits from structured verification (complex features, multi-step implementations)
- The user wants continuous improvement without a fixed endpoint (open mode)
- You determine that a simple goal would lack sufficient verification rigor

Do NOT call this for simple tasks where `CreateGoal` suffices. Do NOT create goals for greetings or ordinary questions.

Requires user approval before activation.
