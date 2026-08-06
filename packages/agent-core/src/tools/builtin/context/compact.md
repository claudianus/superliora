Compact the conversation history now, at a moment you choose.

Use when you are about to start a fresh phase of work and the earlier detail is unlikely to matter: after finishing a subtask, after a long debugging session whose conclusion is already captured, or before reading large new material. Compaction summarizes the older prefix of the history; recent messages stay intact, and archived tool results remain recoverable via Expand.

Do NOT use when the current phase still depends on earlier details — the summary lossy-compresses them. The full transcript is never deleted from disk either way.

Runs in the background; you can keep working. Pass `instruction` to steer what the summary must preserve (e.g. "keep the failing test names and the fix plan").

Use `action: "status"` to check current context tokens vs the compaction threshold before deciding whether to compact — compact when the current phase is done and usage is climbing, not on a fixed schedule.
