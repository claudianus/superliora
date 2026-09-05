# Changesets

This repo uses [changesets](https://github.com/changesets/changesets) for versioning and changelogs.

## Packages

- `@superliora/liora` is the only user-facing released package (the CLI).
- Every other `@superliora/*` package is internal. Internal source that enters the CLI bundle
  (agent-core, node-sdk, kosong, kaos, oauth, acp-adapter, …) must list `@superliora/liora` in the
  changeset — changesets will not propagate bumps through devDependencies.

## Bump levels

| Level | When |
| --- | --- |
| `patch` | Bug fixes, wording, internal refactors, small UX tweaks |
| `minor` | A substantial new user-facing capability (new command, tool, mode) |
| `major` | Breaking changes — never write `major` without explicit user approval |

## Entry rules

- One logical change per file; kebab-case filename under `.changeset/`.
- Changelog entries in English, one short sentence, plus a one-line usage hint for new features.
- Plain, direct wording — no filler (`robust`, `seamless`, `enhance`, …), no file/class/PR names,
  no real internal endpoints or keys.
- Docs-only and test-only changes usually need no changeset.
- Upstream port PRs update `meta/upstream.lock.yaml` first and describe SuperLiora user impact,
  not the upstream bump.

Full conventions and examples: `.agents/skills/gen-changesets/SKILL.md`.
