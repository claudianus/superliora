import { ambientAnimationRenderTick } from '#/tui/utils/appearance-effects';
import type { Text } from '#/tui/renderer';

/**
 * Render-cache toggle for TUI message components.
 *
 * The transcript re-renders the entire component tree on every frame, and
 * most message components rebuild their `render(width)` output from scratch
 * even when their content has not changed. Caching the rendered lines (keyed
 * on width + a dirty flag) turns an unchanged message's render into an O(1)
 * array reference return, which is the dominant per-frame cost once the
 * transcript grows long.
 *
 * The cache is on by default and can be disabled with
 * `KIMI_TUI_NO_RENDER_CACHE=1` as an escape hatch (and to let benchmarks
 * compare cached vs. uncached runs in the same process).
 */

let enabled = process.env['KIMI_TUI_NO_RENDER_CACHE'] !== '1';

export function isRenderCacheEnabled(): boolean {
  return enabled;
}

/**
 * Epoch that advances with the shared ambient-animation clock. Render caches
 * include this value so gradient/pulse text repaints every animation frame
 * instead of freezing on the first painted colors.
 */
export function renderCacheEpoch(): number {
  if (!enabled) return -1;
  return ambientAnimationRenderTick();
}

/**
 * Refresh a Text child when the ambient-animation epoch advances.
 */
export function syncAmbientAnimatedText(
  text: Text,
  render: () => string,
  state: { ambientAnimationEpoch: number },
): void {
  const epoch = renderCacheEpoch();
  if (epoch < 0 || epoch === state.ambientAnimationEpoch) return;
  state.ambientAnimationEpoch = epoch;
  text.setText(render());
}

/**
 * Override the cache at runtime. Intended for benchmarks / tests only;
 * production code should not call this.
 */
export function setRenderCacheEnabled(value: boolean): void {
  enabled = value;
}
