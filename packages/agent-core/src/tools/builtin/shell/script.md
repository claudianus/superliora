Run one JavaScript snippet that calls tools as functions and processes results in code — use it when a task needs the same operation across many items (read 50 files, aggregate, transform) so you don't pay one model round-trip per item or flood the context with raw output.

**Available functions (all async except where noted):**
- `read(path)` → file contents (relative paths resolve from the workspace cwd)
- `write(path, text)` → write a file
- `glob(pattern)` → array of matching paths (capped at 1000)
- `exec(command)` → `{ stdout, stderr, code }` (runs via `bash -lc`)
- `agent(prompt, profile?)` → run a subagent and get its result text (main agent only; `Promise.all` over items for parallel fan-out)
- `sleep(ms)`
- `store` — persistent plain object shared across Script calls in this session; keep cross-call state here (top-level `const` does NOT carry over)
- `console.log(...)` — captured into the output

**Return the final summary with `return`.** Only console output plus the return value (capped at 8k chars) enters the conversation — keep raw data in `store` or files, return aggregates.

**Examples:**

Bulk analysis without context bloat:
```js
const files = await glob('src/**/*.ts');
const counts = {};
for (const f of files) {
  const text = await read(f);
  counts[f] = (text.match(/TODO/g) ?? []).length;
}
return Object.entries(counts).filter(([, n]) => n > 0);
```

Programmatic subagent fan-out (main agent only):
```js
const items = ['src/auth', 'src/api', 'src/db'];
const reviews = await Promise.all(items.map(dir =>
  agent(`Review ${dir} for error-handling gaps. Return 3 bullets max.`)
));
return reviews.join('\n---\n');
```

**Notes:** scripts are not a sandbox (you already have Bash) — the point is persistence and structured I/O. Sync infinite loops are killed by the timeout; async hangs are reported at the timeout but the detached promise may keep running. Long bulk output belongs in files, not the return value.
