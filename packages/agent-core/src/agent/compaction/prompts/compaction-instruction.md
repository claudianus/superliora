You are about to run out of context. Write a handoff so you can continue after earlier conversation is cleared.

--- This message is a direct task, not part of the above conversation ---

## Output contract (required)

Use **exactly** these section labels. This is OpenCode-style structured handoff:
**Objective** → `current_goal`, **Work State** → `last_known_state`, **Next Move** → `next_actions`, **Relevant Files** → `files_touched`.
Bullet lists under each label. Fill them with concrete session facts.

current_goal:
- (Objective) One line: what you are trying to achieve for the latest user ask (the governing request).

last_known_state:
- (Work State) What is true right now (files, branch, test status, running processes, blockers).
- Prefer measured facts over impressions.

decisions:
- Settled choices that still constrain the next step (and rejected alternatives that matter).

files_touched:
- (Relevant Files) Paths you edited, created, deleted, or must re-read. Prefer exact paths.

failed_attempts:
- Commands/approaches that failed with the error/signal that matters. Skip pure noise.

open_questions:
- Unknowns that would change the next action if answered.

next_actions:
- (Next Move) Ordered, executable next steps (exact tool/command when possible). First item is the immediate next step.

verified_claims:
- Each done/verified item as: `claim | evidence=<test id, log path, or command> | needs_revalidation=true|false`
- Anything not re-verified in this session is `needs_revalidation=true`.

raw_refs:
- Durable ids only: WorkGraph node ids, AC ids, evidence_ids, archive markers (`liora-archived`), plan paths, goal status. Prefer concrete ids over "see above".

After the structured sections, you may add a short first-person narrative (optional, ≤15 lines) for insights that do not fit bullets. Do not put required facts only in the narrative.

## Continuity rules

The next turn sees only recent user messages and this handoff — every assistant message, tool call, and tool result above will be gone. Preserve what you need to continue:

- Latest request wins: intent, resolved ambiguity, at-risk parts of large pastes. If multiple requests are active, which governs next.
- Instructions/constraints still in force — condensed.
- Exact commands, paths, success/failure, key outputs/errors/schemas. Keep final working code; drop pure dead ends.
- Insights and root causes found while debugging/researching.
- Label completed/pending items as historical when they are not the active ask — do not "finish" stale work unless the latest user message requests it.

Your TODO list re-attaches from live source — do not transcribe it. Record reasoning between tasks (reorder, drops, cross-task decisions) instead.

Be honest: if something was claimed done but unverified (tests "passing", fix "working"), say so. Prefer deterministic re-check over trusting success claims.

Be concise and proportional — a nearly done exchange needs few bullets. Include identifiers needed for the next move; omit what does not change it.

Respond with text only. Do not call any tools — you already have everything you need in the conversation history.

Use the conversation's language, not English by default.

{% if customInstruction %}
Optional user instruction:
{{ customInstruction }}
{% endif %}
