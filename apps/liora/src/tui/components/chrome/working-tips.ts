import { WORKING_TIPS, type ToolbarTip } from '#/tui/constant/tips';
import { ttui } from '#/tui/utils/tui-i18n';

import { buildWeightedTips } from './footer';

export { WORKING_TIPS };

const TIP_ROTATE_INTERVAL_MS = 10_000;

const WORKING_TIP_ROTATION = buildWeightedTips(WORKING_TIPS);

export function currentWorkingTip(now = Date.now()): ToolbarTip | undefined {
  if (WORKING_TIP_ROTATION.length === 0) return undefined;
  const index = Math.floor(now / TIP_ROTATE_INTERVAL_MS) % WORKING_TIP_ROTATION.length;
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
  return ttui(tip.key);
}
