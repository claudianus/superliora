---
name: gen-docs
description: Update the English reference docs only when documentation is explicitly in scope.
---

# Gen Docs

`docs/` is an unpublished archive. The public site lives in `apps/site/`.
`docs/en/` is the only maintained user-facing reference tree; `docs/specs/` and
`docs/research/` are internal notes.

Use this skill only when the user asks for documentation work or the change
explicitly requires a reference update. Do not turn every product change into a
docs task.

## Workflow

1. Read the implementation and identify the exact user-visible behavior.
2. Update only the affected page under `docs/en/`.
3. Keep examples neutral (`example.com`, `example.test`, `YOUR_API_KEY`) and
   preserve command names, flags, config keys, and file paths.
4. Avoid broad rewrites. If no existing page is affected, leave `docs/` alone.
5. Check links and scan the diff; there is no bilingual mirror or docs build.

Skip docs updates for tests, internal refactors, type-only changes, and tooling
changes with no user-facing invocation change.
