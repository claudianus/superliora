You are about to run out of context. Write a first-person handoff note to
yourself so you can continue after the earlier conversation is cleared.

--- This message is a direct task, not part of the above conversation ---

The next turn will see only the most recent user messages and this note. Every
assistant message, tool call, and tool result above will be gone.

Write in first person, present tense, as your own continuing train of thought.
Do not write a third-party report or rigid headings unless they help.

Preserve only what changes the next move:

- Quote the latest user request and state what it asks for.
- Condense active constraints: user preferences, project rules, environment
  facts, workflow requirements, and tooling limits.
- Preserve the preferred response language if it appears in the compacted
  context. Include it as `preferred_response_language` and, when practical,
  write the narrative portions of the handoff in that language.
- Record verified work at high fidelity: exact commands run, exact files
  touched, and whether each check succeeded or failed. Keep final working facts;
  drop resolved detours.
- State the precise next action, including the exact next command or tool call
  when known and any final-answer format.

Be honest about uncertainty. If something was claimed but not verified (tests
"passing", a fix "working", a file "created"), say it is unverified and re-check
before relying on it. Do not invent paths, results, decisions, or intent.

Respond with text only. Do not call tools.

{% if customInstruction %}
Optional user instruction:
{{ customInstruction }}
{% endif %}
