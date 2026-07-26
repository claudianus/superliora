---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/matches-rule regression cases

- `parsePattern` — pin the tool-name-only parse (with trim), the `Tool(argPattern)` split, the preservation of a leading `!` in the arg pattern, the `Tool()` empty-arg-pattern shape, the empty-pattern / missing-closing-paren / empty-tool-name error throws, and the literal `mcp__server__*` glob parse.
- `matchPermissionRule` — pin the literal tool-name match (with the `tool_name_only` strategy), the rejection of a non-matching tool name, the `*` wildcard, the `mcp__server__*` glob match, the `matches_rule` strategy when `execution.matchesRule` returns true, the `undefined` return when `execution.matchesRule` is missing for a pattern that has args, the `undefined` return when `execution.matchesRule` returns false, and the malformed-pattern `undefined` return.
