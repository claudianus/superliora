import {
  appearanceAnimationNow,
  CROSSFADE_MS,
  getActiveAppearancePreferences,
  renderCrossfadeLine,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

import type { StatusFieldRow } from './status-panel-provider-route';

/** Tracks prior field values so status rows can crossfade on change. */
export interface StatusFieldMotionState {
  readonly previousValues: Map<string, string>;
  readonly changedAtMs: Map<string, number>;
}

export function createStatusFieldMotionState(): StatusFieldMotionState {
  return {
    previousValues: new Map(),
    changedAtMs: new Map(),
  };
}

type Colorize = (text: string) => string;

function paintStatusFieldValue(
  label: string,
  raw: string,
  colorize: Colorize,
  fieldMotion: StatusFieldMotionState | undefined,
): string {
  if (fieldMotion === undefined) return colorize(raw);
  const appearance = getActiveAppearancePreferences();
  if (!shouldRenderAmbientEffects(appearance)) {
    fieldMotion.previousValues.set(`@current:${label}`, raw);
    return colorize(raw);
  }

  const currentKey = `@current:${label}`;
  const prevKey = `@prev:${label}`;
  const current = fieldMotion.previousValues.get(currentKey);
  if (current !== raw) {
    fieldMotion.previousValues.set(prevKey, current ?? raw);
    fieldMotion.previousValues.set(currentKey, raw);
    fieldMotion.changedAtMs.set(label, appearanceAnimationNow());
  }

  const from = fieldMotion.previousValues.get(prevKey);
  const to = fieldMotion.previousValues.get(currentKey) ?? raw;
  const startedAtMs = fieldMotion.changedAtMs.get(label);
  if (from !== undefined && startedAtMs !== undefined && from !== to) {
    const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
    const duration = mode === 'subtle' ? CROSSFADE_MS * 1.4 : CROSSFADE_MS;
    if (appearanceAnimationNow() - startedAtMs < duration) {
      return renderCrossfadeLine(from, to, `status:${label}`, startedAtMs, appearance);
    }
  }
  return colorize(to);
}

export function addStatusFieldRows(
  lines: string[],
  rows: readonly StatusFieldRow[],
  muted: Colorize,
  value: Colorize,
  errorStyle: Colorize,
  warningStyle: Colorize = value,
  fieldMotion?: StatusFieldMotionState,
): void {
  const labelWidth = Math.max(10, ...rows.map((row) => row.label.length));
  for (const row of rows) {
    const colorize =
      row.severity === 'error'
        ? errorStyle
        : row.severity === 'warning'
          ? warningStyle
          : value;
    const painted = paintStatusFieldValue(row.label, row.value, colorize, fieldMotion);
    lines.push(`  ${muted(row.label.padEnd(labelWidth, ' '))}  ${painted}`);
  }
}
