# Common use cases

This page collects typical SuperLiora CLI scenarios along with ready-to-use prompt examples — copy them as-is or adapt them to your needs.

## Understanding an unfamiliar project

Start with an ordinary prompt that explicitly asks for investigation without edits. Planning is conversation, not a separate CLI mode:

```
Give me an overview of this repository's architecture. Specifically:
1. Where is the entry point and what happens at startup?
2. How do the main modules depend on each other?
3. How are configuration and data loaded?
Finally, draw a simple module dependency diagram.
```

You can also focus on a specific question:

```
How does the event loop in src/runtime work? Where do events originate, and what consumes them?
```

```
How is "permission approval" implemented in this project? Which files are involved, and what are the key types?
```

For independent investigations, ask the main agent to spawn child sessions through [SessionControl](../reference/tools.md#sessioncontrol). Supply each child's task and boundaries explicitly; child sessions are not automatically isolated checkouts.

## Implementing a new feature

Describe the requirement and acceptance criteria clearly. If you want to confirm the approach before execution, ask the agent to explain it and wait for your response:

```
Add a retry utility under src/utils:
- Signature: retry<T>(fn: () => Promise<T>, options): Promise<T>
- Options: maxAttempts, initialDelayMs, backoffFactor
- On failure, throw the error from the last attempt
- Add a unit test suite covering: success on first try, success after retries, and all attempts failing
```

If the result isn't right, just describe what you want changed — no need to edit manually:

```
The backoff calculation used a fixed value. I'd like to add some jitter to avoid the thundering-herd effect. Update the implementation and the tests.
```

## Fixing a bug

Give the symptom, reproduction steps, and expected behavior all at once to avoid back-and-forth clarification:

```
Running npm test occasionally produces this error:

  TypeError: Cannot read properties of undefined (reading 'id')
      at SessionStore.update (src/session/store.ts:142:18)

It only appears in test cases that concurrently trigger multiple updates. Please locate the cause and fix it, then run the full test suite to confirm.
```

When the root cause is unclear, ask the agent to investigate before making changes:

```
User feedback: after a successful login, the first page refresh sends you back to the login page; a second refresh works fine. Please find the most likely causes first and list the most suspicious locations. I'll confirm the direction before you start making changes.
```

For purely mechanical tasks, you can let the agent run freely:

```
Run the test suite, fix every failing test case, then run it again to confirm everything is green.
```

## Writing tests and refactoring

Tasks with clear boundaries and explicit acceptance criteria are particularly well-suited for the agent:

```
src/parser/markdown.ts currently has almost no tests. Please add a unit test suite covering: normal paragraphs, nested lists, code blocks, tables, blockquotes, and mixed content. Follow the testing style already used in the project.
```

```
Extract the repeated "read body → validate → log → respond" pattern in src/handlers into a middleware. Run the tests afterwards to make sure existing behavior is unchanged.
```

For multi-file refactors, ask for an explanation before edits when needed. `/fork` creates an independent conversation, not a git branch. Use `liora --worktree` or a native Job when you need an isolated checkout.

## One-off scripts and automation

Batch file edits, statistics collection, and research comparisons can all be done with a single prompt:

```
Change all var declarations in .js files under src to const or let, preferring const where possible. Run lint once you're done to confirm.
```

```
Analyze the access logs in logs/ from the past 7 days. For each API path, compute the call count, p50, and p99 response times, and output the results as a Markdown table.
```

```
Research the main dependency injection options for TypeScript (tsyringe, inversify, awilix). Compare them across three dimensions: API style, decorator requirements, and runtime overhead. Give me a recommendation that fits on one page.
```

For batch tasks you know are safe, use `--yolo` or `/yolo` to skip approval prompts, or add pre-approved allowlist rules for specific tools in [Configuration files](../configuration/config-files.md#permission).

## Generating and maintaining documentation

```
I just changed the interface signature in src/auth/login.ts. Please update the corresponding JSDoc, the example code in README, and any paragraphs in docs/en/guides that mention this interface.
```

```
For every public function under src/api that is missing a docstring, add a documentation comment following the style of the existing ones.
```

```
Based on the command implementations in src/cli, generate a draft command reference listing each subcommand, its arguments, and default values. Put it in docs/en/reference for me to review later.
```

When you need a record or a retrospective, use `liora export <sessionId>` to package the session as a ZIP, or use `/export-md` inside the TUI to export a readable Markdown transcript.

## Next steps

- [Sessions and context](./sessions.md) — durable conversations, aside forks, and compaction
- [Built-in tools](../reference/tools.md) — Bash and SessionControl
