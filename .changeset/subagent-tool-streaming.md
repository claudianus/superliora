---
'@superliora/liora': minor
---

Background subagent tool calls now stream live into the TUI. A per-subagent activity feed shows each running subagent's last few tool calls with name, args preview, and status (spinner while running, ✓/✗ on completion), driven by new `subagent.tool_call` / `subagent.tool_result` session events. Payloads are truncated at the source, so large tool args or results never reach the UI verbatim.
