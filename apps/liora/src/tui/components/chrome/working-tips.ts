import { WORKING_TIPS, type ToolbarTip } from '#/tui/constant/tips';
import { shortcutHint } from '#/tui/utils/os-shortcuts';

import { buildWeightedTips, tipRotationIndex } from './footer/footer-tips';

export { WORKING_TIPS };

const WORKING_TIP_ROTATION = buildWeightedTips(WORKING_TIPS);

/** Rotates on the shared motion clock, in step with the footer tips. */
export function currentWorkingTip(now?: number): ToolbarTip | undefined {
  if (WORKING_TIP_ROTATION.length === 0) return undefined;
  const index = tipRotationIndex(now) % WORKING_TIP_ROTATION.length;
  return WORKING_TIP_ROTATION[index];
}

/**
 * Pick a random tip from the weighted working-tip rotation.
 * If `excludeKey` is provided and there are other tips available, avoid
 * returning the same tip twice in a row.
 */
export function pickRandomWorkingTip(excludeKey?: string): ToolbarTip | undefined {
  if (WORKING_TIP_ROTATION.length === 0) return undefined;
  const candidates =
    excludeKey === undefined || WORKING_TIP_ROTATION.length === 1
      ? WORKING_TIP_ROTATION
      : WORKING_TIP_ROTATION.filter((t) => t.key !== excludeKey);
  const pool = candidates.length > 0 ? candidates : WORKING_TIP_ROTATION;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

/** Localized tip text for a toolbar tip entry. */
export function tipText(tip: ToolbarTip): string {
  return shortcutHint(tip.key);
}
