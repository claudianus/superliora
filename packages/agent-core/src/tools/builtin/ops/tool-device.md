Call a tool whose schema is not in your request, or list what is available.

Some tools are kept out of the tool block to leave room for the ones used every
turn. They still work — reach them here.

- `action: "list"` — the inventory: every device tool with a one-line summary.
- `action: "run"` — execute one: `name` is the tool name, `arguments` is the
  same JSON object you would have passed to it directly.

Parameters are validated against the target tool's own schema, and its
approval rules still apply, so a run can be paused for confirmation exactly as
a direct call would be. If a tool you expected is missing from your tool block,
`list` first: it is probably here.