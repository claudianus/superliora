# Letterbox asteroid meteors — Implementation Plan

> **For agentic workers:** Implement TDD-style; commit after green tests.

**Goal:** Inbound meteors from N/E/S/W + corners with S/M/L classes; mega rim burst (flash → shock ring → debris → afterglow). Letterbox clip only.

**Architecture:** Keep sky paint in `stage-letterbox-sky.ts`. Derive stage outer hole from letterbox bands. Deterministic showers from `nowMs` + hash.

**Tech stack:** TypeScript, vitest (`apps/liora`).

---

### Task 1: Failing tests for inbound sectors + mega burst glyphs

**Files:** `apps/liora/test/tui/utils/stage-letterbox-sky.test.ts`

- Assert heads appear near top AND bottom AND side gutters over a time scan.
- Assert burst cells include ring glyphs (`░`/`▒`/`▓` or similar) and dense sparks.
- Keep letterbox-only invariant.

### Task 2: Implement inbound meteorology + `paintRimMegaBurst`

**Files:** `apps/liora/src/tui/utils/stage-letterbox-sky.ts`

- `resolveStageHoleFromBands`
- Sector spawn + linear aim at rim
- Size class scaling
- Mega burst phases

### Task 3: Changeset + PR

- `.changeset/*.md` patch `@superliora/liora`
- Do not commit design doc from other worktree unless copied intentionally (skip product docs commit if unused).
