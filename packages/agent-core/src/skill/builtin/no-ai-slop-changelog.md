---
name: no-ai-slop-changelog
description: Write changesets, changelogs, PR descriptions, and release notes without AI slop. Use when running gen-changesets, sync-changelog, opening PRs, or editing .changeset markdown.
---

# No AI Slop — Changelog & PR Prose

Repo release text must be **plain English**, one clear fact per sentence.

## Banned words (changesets & PRs)

delve, leverage, utilize, robust, streamline, pivotal, testament, foster, cutting-edge, seamless, comprehensive, enhance (as filler), landscape, embark, underscore, realm, meticulous, bespoke, game-changer, revolutionary, dynamic (hype).

**Use:** use, apply, simplify, support, reliable, important, add, fix, remove.

## Changeset rules (with gen-changesets skill)

- One short sentence stating what changed; optional one-line usage hint for new features.
- No file names, class names, PR numbers, or internal identifiers.
- No vague "refactor/optimize/improve" without the actual behavior change.

## PR description shape

```markdown
## Summary
- What problem this solves (concrete)
- What changed (behavior, not file list spam)

## Test plan
- [ ] Commands run and results
```

- No engagement bait, no "this PR leverages…", no rule-of-three feature marketing.
- Complete sentences; no bold-inline-header bullet walls.

## Workflow

1. Load `gen-changesets` or `sync-changelog` skill when applicable.
2. Draft in plain language.
3. Run `pnpm run check:slop` on `.changeset/*.md` and staged docs.
4. Self-audit with `avoid-ai-writing` checklist.
