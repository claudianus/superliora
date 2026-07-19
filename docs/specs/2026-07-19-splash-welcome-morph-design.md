# Splash → Welcome morph handoff

Date: 2026-07-19  
Scope: `apps/liora` TUI splash cinematic end → Welcome first frame

## Problem

Iris reveal paints a full-terminal Welcome+Tank preview that does not match the real centered stage (≤90), letterbox sky, or stage frame. A frozen `cachedRevealFrame` also freezes Welcome wave / tank motion for ~1s before a hard cut to live TUI.

## Goal

Replace iris with a **morph handoff** where the fullscreen SUPERLIORA brand continuously shrinks into the Welcome box hero rect, while Welcome + Jewel Tank + stage frame are composited at the **real** stage layout. Morph end frame ≈ first `renderWelcome()` frame.

## Design

### Phase

After cinematic hold/fade, enter `morph` (~1000–1200ms, ease-out cubic / smoothstep):

1. Resolve real layout via `resolveStageLayout` (+ bundle / letterbox bands).
2. Lerp brand figlet from splash center rect → Welcome banner hero rect inside the stage.
3. Fade in Welcome chrome + IdleStage (Jewel Tank) using **live** paints each tick (no frame cache).
4. Blend letterbox: splash starfield → letterbox night sky; paint stage frame entrance in sync.
5. On complete: dispose splash, `renderWelcome()` — no visual jump.

### Removals / deprecations

- `applyIrisReveal` path for startup handoff (keep util if unused tests — migrate tests to morph).
- `cachedRevealFrame` freeze during handoff.

### Non-goals

- Redesign cinematic phases before morph.
- Chrome header/footer morph (restore as today after splash dispose).
- Sound / true Unicode glyph interpolation beyond rect/scale/fade.

## Verification

- Unit: morph progress 0→1 maps brand rect; layout uses stage max width; no iris-only assertions left for startup.
- Manual: cold start — SUPERLIORA shrinks into Welcome; no pop when TUI mounts; letterbox+frame present at handoff end.
