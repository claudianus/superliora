---
name: project-checks
description: >
  SuperLiora project verification — prefer RunProjectChecks (and package
  test/typecheck/build scripts) over catalog test-runner playbooks. Use before
  claiming done. Skill("project-checks").
whenToUse: >
  run tests, typecheck, lint, RunProjectChecks, project checks — before
  generic test-runner / jest-expert catalog skills.
---

# SuperLiora project-checks (builtin)

Hard rule: call **RunProjectChecks** when available. Otherwise run the repo's
documented `pnpm`/`npm` test|typecheck|lint|build via the local test gate
(`scripts/test-local.mjs` in this monorepo).

## Happy path

1. Prefer `RunProjectChecks` for the profile's configured gate.
2. Focused iteration: one package / one case through the repo's parity runner.
3. No "done" without green evidence (or an explicit blocked reason).

## Do not

- Install a second test framework from a catalog skill for an existing repo.
- Treat catalog "test-runner" skills as a substitute for RunProjectChecks.
