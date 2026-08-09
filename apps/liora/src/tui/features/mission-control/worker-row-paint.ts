/**
 * Paint helpers for selectable / hoverable Worker Dock rows.
 * Motion uses the shared appearance clock — never raw setInterval.
 */

import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { AppearancePreferences } from '#/tui/config';
import {
  appearanceAnimationNow,
  renderPulseText,
  renderToneSettleFlash,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import {
  getHoverEnteredAtMs,
  isHoverRegion,
  missionWorkerHoverId,
} from './worker-hover';

/**
 * Hover-only gutter glyph — deliberately not SELECT_POINTER (❯).
 * PREMIUM selection language allows one ❯ cursor; hover is a softer pad.
 */
export const HOVER_ROW_PAD = '·';

export interface WorkerRowChromeOptions {
  readonly workerId: string;
  readonly selected: boolean;
  readonly appearance: AppearancePreferences;
  readonly animated: boolean;
  /** When true, prepend selection/hover chrome. */
  readonly showPointer?: boolean;
}

/**
 * Leading chrome for a dock worker row.
 * Selected → bold SELECT_POINTER (❯). Hover-only → HOVER_ROW_PAD (·) so a
 * selected row and a different hovered row never paint two ❯ cursors.
 * Idle rows return empty (callers may still reserve a fixed gutter).
 */
export function paintWorkerRowChrome(options: WorkerRowChromeOptions): string {
  const { workerId, selected, appearance, animated } = options;
  const showPointer = options.showPointer !== false;
  if (!showPointer) return '';

  const hoverId = missionWorkerHoverId(workerId);
  const hovering = isHoverRegion(hoverId);

  if (!selected && !hovering) return '';

  if (selected) {
    if (animated && shouldRenderAmbientEffects(appearance)) {
      return `${renderPulseText(SELECT_POINTER, `mc:sel:${workerId}`, 'primary', appearance)} `;
    }
    return `${currentTheme.boldFg('primary', SELECT_POINTER)} `;
  }

  // Hover on a non-selected row — never reuse SELECT_POINTER.
  const entered = getHoverEnteredAtMs();
  if (animated && shouldRenderAmbientEffects(appearance) && entered > 0) {
    return `${renderToneSettleFlash(
      HOVER_ROW_PAD,
      `mc:hov:${workerId}`,
      entered,
      'primary',
      appearance,
    )} `;
  }
  return `${currentTheme.fg('primary', HOVER_ROW_PAD)} `;
}

/**
 * Wrap a worker row body with selection / hover emphasis on the name span.
 * Returns the painted body fragment (caller still concatenates telemetry).
 */
export function paintWorkerNameEmphasis(
  namePaint: string,
  options: WorkerRowChromeOptions,
): string {
  const { workerId, selected, appearance, animated } = options;
  const hovering = isHoverRegion(missionWorkerHoverId(workerId));
  if (!selected && !hovering) return namePaint;
  if (!animated || !shouldRenderAmbientEffects(appearance)) {
    return selected
      ? currentTheme.boldFg('primary', stripForRebold(namePaint) || namePaint)
      : namePaint;
  }
  if (selected) {
    return renderPulseText(
      stripForRebold(namePaint) || '·',
      `mc:name:${workerId}`,
      'primary',
      appearance,
    );
  }
  const entered = getHoverEnteredAtMs();
  if (entered > 0) {
    return renderToneSettleFlash(
      stripForRebold(namePaint) || '·',
      `mc:name-hov:${workerId}`,
      entered,
      'primary',
      appearance,
    );
  }
  return namePaint;
}

/** Whether hover paint is still settling (forces ambient memo bust). */
export function workerHoverPaintPending(
  workerId: string | undefined,
  appearance: AppearancePreferences,
  nowMs: number = appearanceAnimationNow(),
): boolean {
  if (workerId === undefined) return false;
  if (!shouldRenderAmbientEffects(appearance)) return false;
  if (!isHoverRegion(missionWorkerHoverId(workerId))) return false;
  const entered = getHoverEnteredAtMs();
  if (entered <= 0) return false;
  // Match SETTLE_FLASH_MS ~520ms (subtle stretches); keep a short window.
  return nowMs - entered < 900;
}

function stripForRebold(text: string): string {
  return text.replaceAll(/\u001b\[[0-9;]*m/g, '');
}
