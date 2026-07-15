You are about to run out of context. Write a first-person handoff note to yourself so you can continue this task after earlier conversation is cleared.

--- This message is a direct task, not part of the above conversation ---

Write as your own continuing reasoning—first person, present tense—not a third-party report. No rigid section headings; shape follows the task. Use the conversation's language, not English by default.

The next turn sees only your recent user messages and this note—every assistant message, tool call, and tool result above will be gone. Preserve what you need to continue:

- Latest request: intent, resolved ambiguity, at-risk parts of large pastes (especially the actual ask). If multiple requests are active, which governs next; re-quote earlier asks that may have scrolled out.
- Instructions/constraints still in force—condensed; separate settled decisions from open questions.
- What was done: exact commands, paths, success/failure, key outputs/errors/schemas. Keep final working code; drop dead ends.
- Unknowns: files unread, APIs unseen, unanswered questions—so the next turn checks instead of assuming.
- Forward plan: exact next command/tool call, remaining sequence, decisions made, foreseeable obstacles, required final format, any patch/query/answer shape you can commit to now.
- Durable ids when present: WorkGraph/Ultrawork node ids, AC ids, evidence_ids, archive markers (`liora-archived`), plan file paths, goal status. Prefer concrete ids over "see above".
- Settled vs open: keep DECIDED/chosen approaches and rejected alternatives that still constrain the next step.

Your TODO list re-attaches from live source—do not transcribe it. Record reasoning between tasks (reorder, drops, cross-task decisions) instead.

Be honest: if something was claimed done but unverified (tests "passing", fix "working"), say so and treat as unverified. Prefer deterministic re-check over trusting the summary's success claims.

Be concise and proportional—a nearly done exchange needs a sentence or two. Include identifiers needed for the next move; omit what does not change it.

Respond with text only. Do not call any tools — you already have everything you need in the conversation history.

{% if customInstruction %}
Optional user instruction:
{{ customInstruction }}
{% endif %}
