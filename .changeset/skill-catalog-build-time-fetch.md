---
'@superliora/liora': patch
---

Stop vendoring the external skill catalog in the repo.

`packages/agent-core/src/skill/catalog/` held ~23k files (~187 MB) fetched from
seven third-party skill repos and committed as build output. It is now a
gitignored build artifact:

- Fresh checkouts ship builtin skills only; `SearchSkill` degrades gracefully
  until the catalog is fetched.
- Source installs (`install.sh`, `~/.superliora/source` upgrades) fetch the
  catalog automatically after `pnpm install` and skip gracefully when offline
  (`SUPERLIORA_SKIP_SKILL_CATALOG=1` forces the skip).
- Manual fetch: `pnpm run build:skill-catalog`.
- The catalog build script moved to `packages/agent-core/scripts/` so its
  `js-yaml` dependency resolves, and `retrieval:build` now skips the skill
  corpus when the index has not been fetched instead of crashing.
