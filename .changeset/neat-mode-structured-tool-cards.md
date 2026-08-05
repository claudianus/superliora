---
"@superliora/liora": minor
---

Add neat mode: recognized tool results now render as structured cards instead of raw log dumps. The harness classifies test runner, typecheck, lint, build, git, and package-install output in agent-core and ships it alongside the raw text, so the transcript shows counts, timing, and the first failing locations with the same status colors the Conductor Job Desk uses. MCP results that return JSON render as key/value rows. Neat is on by default; `/neat off` or `[appearance] neat = false` restores raw output, and transcript detail `full` keeps the raw body below the card.
