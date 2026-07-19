# Letterbox meteor inbound + asteroid rim burst

Date: 2026-07-19  
Scope: `apps/liora/src/tui/utils/stage-letterbox-sky.ts` (+ tests, changeset)

## Goal

Replace soft side-gutter diagonals with meteors that inbound from **all letterbox edges and corners**, classified as **small / medium / large**, and explode on the **stage-facing rim** with a mega shockwave (flash core → expanding ring → debris with light gravity → afterglow). Never paint into the stage content rect.

## Constraints

- Paint only via existing `put()` letterbox clip (`pointInLetterboxBands`).
- Keep twinkle quantization and dense letterbox regions with `clear: false` (no flicker regression).
- Premium: more showers + large class allowed; ambient: fewer, mostly S/M.

## Spawning

- Resolve stage outer rim from letterbox geometry (the hole = stage + frame inset). Meteors spawn on screen-edge letterbox cells: N/E/S/W mid-edges **and** four corners.
- Velocity aims at a random point on the corresponding facing rim (corners aim at nearest corner or mid-side of the stage outer rect).
- Classes:
  - **S**: short trail, thin head (`◆`), small burst
  - **M**: medium trail (`◈`/`◆`), standard burst
  - **L** (rare, premium-biased): long bright trail, heavy burst

## Impact FX (size-scaled)

Phase by explosion age `t ∈ [0,1]`:

1. **Flash** (`t < ~0.15`): bold core glyphs `✹◈⬤`
2. **Shock ring** (`t < ~0.55`): discrete ring cells expand outward into letterbox; glyphs `░▒▓` / `✦˚·`
3. **Debris** (full life): radial sparks biased **away from stage**, slight +Y drift (gravity)
4. **Afterglow** (`t > ~0.55`): muted dust fade near impact

## Non-goals

- No stage-interior paint, shake, or sound.
- No rare “full-ring simultaneous flash” super-event (deferred).
- No persistent particle state across ticks beyond deterministic `nowMs` hash (keep frozen-frame determinism).

## Verification

- Unit: cells stay in letterbox; heads appear from ≥3 spawn sectors over time; bursts include ring and debris glyphs; S/M/L differ in trail or spark count.
- Manual: ultrawide centered stage — inbound chaos + readable asteroid pops without center wipe.
