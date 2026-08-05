---
"@superliora/agent-core": patch
---

Point `packages/agent-core`'s `typecheck` script at `tsconfig.src.json`, matching what CI gates. The previous target also compiled `test/`, which carries ~300 known type errors from Node/vitest mock drift, so the repo-wide `pnpm run typecheck` could never pass locally. The test-inclusive run stays available as `typecheck:tests`.
