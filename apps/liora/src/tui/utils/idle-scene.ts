/**
 * Empty-transcript idle scene — Jewel Tank.
 *
 * A curated premium aquarium: clear water, one lead fish, a small school,
 * a seaweed curtain, coral silhouettes, an air-stone plume, and a soft
 * caustic band. Sparse cast, rich layers. No gadget clutter, no splash
 * Blood Moon glyphs.
 *
 * Implementation is split across sibling modules — this file re-exports
 * their public surface so callers keep importing from `idle-scene` — and
 * owns only the top-level scene orchestrator:
 *   - `idle-scene-sprites.ts`   — glyph/frame/timing constants
 *   - `idle-scene-canvas.ts`    — text/cell layout primitives + blit/putCell
 *   - `idle-scene-palette.ts`   — `AquariumPalette` + theme tint resolver
 *   - `idle-scene-fish.ts`      — fish glyphs, tail animation, school + sim paint
 *   - `idle-scene-ambient.ts`   — water/sky layers, light, plankton
 *   - `idle-scene-scenery.ts`   — plants, rock, air-stone, jellyfish, seahorse
 */

import { mixHexColor, styleToAnsi, type RendererCell } from '#/tui/renderer';

import {
  ANSI_RESET,
  expandLineCells,
  beginStoryCellSession,
  cloneCellRow,
  flushStoryCellSession,
  padOrTrim,
  resetIdleSceneCanvasCachesForTests,
  setStoryCellRow,
  waterCell,
} from '#/tui/utils/idle-scene-canvas';
import {
  IDLE_SURFACE_MOTION_QUANTUM_MS,
  paintPlankton,
  paintSurfaceLight,
  paintVolumetricLight,
  paintWaterDepth,
  renderSandLine,
  renderWaterline,
  resetIdleSceneAmbientCachesForTests,
} from '#/tui/utils/idle-scene-ambient';
import {
  paintFishFromSnapshot,
  paintFishSchool,
  paintFoodFromSnapshot,
  paintFxFromSnapshot,
} from '#/tui/utils/idle-scene-fish';
import {
  resolveAquariumPalette,
  type AquariumPalette,
  type IdleSceneColors,
} from '#/tui/utils/idle-scene-palette';
import { paintAirStone, paintCoral, paintJellyfish, paintSeahorse, paintSeaweed } from '#/tui/utils/idle-scene-scenery';
import type { IdleTankSnapshot } from '#/tui/utils/idle-tank-sim';

export * from '#/tui/utils/idle-scene-sprites';
export {
  ANSI_RESET,
  blitAt,
  blitCentered,
  centerText,
  hash2,
  padOrTrim,
  putCell,
  resolveSeaweedSpacing,
  stripAnsi,
} from '#/tui/utils/idle-scene-canvas';
export type { AquariumPalette, IdleSceneColors } from '#/tui/utils/idle-scene-palette';
export {
  JEWEL_TANK_DARK,
  JEWEL_TANK_LIGHT,
  resolveAquariumPalette,
} from '#/tui/utils/idle-scene-palette';
export {
  applyFishTail,
  colorizeFishLine,
  paintFoodFromSnapshot,
  paintFishFromSnapshot,
  paintFxFromSnapshot,
  resolveFishGlyphRows,
} from '#/tui/utils/idle-scene-fish';
export {
  IDLE_SURFACE_MOTION_QUANTUM_MS,
  paintBubbles,
  paintCausticPath,
  paintFireflies,
  paintMist,
  paintPlankton,
  paintSurfaceLight,
  paintVolumetricLight,
  paintWaterBase,
  paintWaterDepth,
  paintWaterField,
  paintWaterShimmer,
  renderBankRail,
  renderHillLine,
  renderSandLine,
  renderWaterline,
  resolveAirStoneGlyph,
} from '#/tui/utils/idle-scene-ambient';
export { paintJellyfish, paintSeahorse } from '#/tui/utils/idle-scene-scenery';

/** Test helper — drop jewel-tank paint caches. */
export function resetIdleScenePaintCachesForTests(): void {
  surfaceBandCache = undefined;
  resetIdleSceneCanvasCachesForTests();
  resetIdleSceneAmbientCachesForTests();
}

type SurfaceBandCacheEntry = {
  readonly key: string;
  readonly waterline: readonly RendererCell[];
  readonly sand: readonly RendererCell[];
};

let surfaceBandCache: SurfaceBandCacheEntry | undefined;

/**
 * Paint the Jewel Tank into `canvas[0..storyRows)`.
 *
 * Aquascape: sky surface, open mid-water, planted bed, rocks, left aerator,
 * fish + optional click-dropped food.
 */
export function paintIdleStoryScene(options: {
  readonly canvas: string[];
  readonly width: number;
  readonly storyRows: number;
  readonly elapsedMs: number;
  readonly showAmbient: boolean;
  readonly premium: boolean;
  readonly paint: (hex: string, text: string) => string;
  readonly colors: IdleSceneColors;
  readonly themeMode?: 'dark' | 'light';
  readonly sim?: IdleTankSnapshot;
}): void {
  const {
    canvas,
    width,
    storyRows,
    elapsedMs,
    showAmbient,
    premium,
    paint,
    colors,
    themeMode = 'dark',
    sim,
  } = options;
  if (width <= 0 || storyRows <= 0) return;

  const palette = resolveAquariumPalette(colors, themeMode);
  beginStoryCellSession(canvas, storyRows, width);

  try {
    const motionMs =
      Math.floor(Math.max(0, elapsedMs) / IDLE_SURFACE_MOTION_QUANTUM_MS) *
      IDLE_SURFACE_MOTION_QUANTUM_MS;

    // 1) Surface line — muted water wash (not an electric cyan banner)
    if (storyRows >= 4) {
      if (!showAmbient) {
        canvas[0] = padOrTrim(paint(colors.textMuted, renderWaterline(width, elapsedMs)), width);
        // Still seed the cell layer so later flush keeps row 0 consistent.
        const muted = expandLineCells(canvas[0]!, width);
        setStoryCellRow(0, muted);
      } else {
        const band = resolveSurfaceBandCells(width, motionMs, palette);
        setStoryCellRow(0, cloneCellRow(band.waterline));
      }
    }

    // 2) Dark gravel bed with warm light glints (2-row substrate)
    const sandY = storyRows - 1;
    if (sandY > 0) {
      if (showAmbient) {
        const band = resolveSurfaceBandCells(width, motionMs, palette);
        setStoryCellRow(sandY, cloneCellRow(band.sand));
        // Upper substrate row: smaller pebbles, shell fragments, debris.
        if (sandY > 1) {
          const upperBed = renderSandLine(width, motionMs, 47);
          const upperSand: RendererCell[] = [];
          for (const ch of upperBed) {
            const isGlint = ch === '˚';
            const hex = isGlint
              ? mixHexColor(palette.coral, palette.shaft, 0.35)
              : mixHexColor(palette.sand, palette.waterAbyss, 0.45);
            const fg = isGlint
              ? mixHexColor(palette.shaft, '#FFF7ED', 0.5)
              : mixHexColor(hex, palette.waterDeep, 0.3);
            upperSand.push(waterCell(ch === 'o' ? '.' : ch === ':' ? '˙' : ch, fg, hex));
          }
          setStoryCellRow(sandY - 1, upperSand);
        }
      } else {
        const bed = renderSandLine(width, elapsedMs, 1);
        let sandPainted = '';
        for (const ch of bed) {
          const hex =
            ch === '˚' ? mixHexColor(palette.coral, palette.shaft, 0.45) : palette.sand;
          sandPainted += `${styleToAnsi({
            fg: mixHexColor(hex, '#FFF7ED', 0.4),
            bg: hex,
          })}${ch}${ANSI_RESET}`;
        }
        canvas[sandY] = sandPainted;
        setStoryCellRow(sandY, expandLineCells(sandPainted, width));
      }
    }

    // 3) Quiet mid-water volume (abyss wash — not neon sky fill)
    if (showAmbient) {
      paintWaterDepth(
        canvas,
        width,
        storyRows,
        paint,
        palette.water,
        palette.waterSoft,
        palette.waterDeep,
        palette.waterAbyss,
      );
    }

    // 4) Volumetric light cones (wide beams from surface)
    if (showAmbient && premium) {
      paintVolumetricLight(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        palette.shaft,
        mixHexColor(palette.water, palette.bubble, 0.4),
      );
    }

    // 5) Surface god-rays + warm caustic ribbon
    if (showAmbient && premium) {
      paintSurfaceLight(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        palette.shaft,
        mixHexColor(palette.water, palette.bubble, 0.4),
      );
    }

    // 6) Floating plankton / detritus motes in the water column
    if (showAmbient) {
      paintPlankton(canvas, width, storyRows, elapsedMs, paint, palette);
    }

    // 7) Plants first (carpet / banks / stem)
    if (showAmbient) {
      paintSeaweed(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        palette.plant,
        palette.plantSoft,
        palette.plantAccent,
        mixHexColor(palette.waterDeep, palette.sand, 0.55),
      );
    }

    // 8) Centerpiece rock on top so hardscape stays readable
    if (showAmbient && premium) {
      paintCoral(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        palette.coral,
        palette.coralSoft,
        palette.sand,
      );
    }

    // 9) Left filter + bubble column (bright jewel bubbles)
    if (showAmbient && premium) {
      paintAirStone(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        mixHexColor(palette.dim, palette.waterDeep, 0.35),
        palette.bubble,
        mixHexColor(palette.bubble, palette.water, 0.4),
      );
    }

    // 10) Jellyfish — bioluminescent drifters in the mid-water column
    if (showAmbient && premium) {
      paintJellyfish(canvas, width, storyRows, elapsedMs, paint, palette);
    }

    // 11) Seahorse — accent creature near the right plant bank
    if (showAmbient && premium) {
      paintSeahorse(canvas, width, storyRows, elapsedMs, paint, palette);
    }

    // 12) Fish + food + interactive physics FX
    if (sim) {
      paintFoodFromSnapshot(canvas, width, paint, palette, sim.food);
      paintFishFromSnapshot(canvas, width, elapsedMs, showAmbient, paint, palette, sim.fish);
      paintFxFromSnapshot(canvas, width, paint, palette, sim.fx);
    } else {
      paintFishSchool(canvas, width, storyRows, elapsedMs, premium, showAmbient, paint, palette);
    }
  } finally {
    flushStoryCellSession(storyRows);
  }
}

function resolveSurfaceBandCells(
  width: number,
  motionMs: number,
  palette: AquariumPalette,
): SurfaceBandCacheEntry {
  const key = `${width}|${motionMs}|${palette.water}|${palette.waterSoft}|${palette.waterDeep}|${palette.waterAbyss}|${palette.sand}|${palette.shaft}|${palette.coral}|${palette.bubble}`;
  if (surfaceBandCache?.key === key) return surfaceBandCache;

  const line = renderWaterline(width, motionMs);
  const wash = mixHexColor(palette.waterAbyss, palette.waterDeep, 0.55);
  const waterline: RendererCell[] = [];
  for (let x = 0; x < line.length; x++) {
    const ch = line[x]!;
    const hex =
      ch === '≈'
        ? mixHexColor(wash, palette.shaft, 0.2)
        : ch === '~'
          ? mixHexColor(wash, palette.water, 0.35)
          : mixHexColor(wash, palette.waterSoft, 0.25);
    waterline.push(waterCell(ch, mixHexColor(palette.water, palette.bubble, 0.35), hex));
  }

  const bed = renderSandLine(width, motionMs, 1);
  const sand: RendererCell[] = [];
  for (const ch of bed) {
    const hex = ch === '˚' ? mixHexColor(palette.coral, palette.shaft, 0.45) : palette.sand;
    sand.push(waterCell(ch, mixHexColor(hex, '#FFF7ED', 0.4), hex));
  }

  surfaceBandCache = { key, waterline, sand };
  return surfaceBandCache;
}
