import { ALL_TIPS, type ToolbarTip } from '#/tui/constant/tips';
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';
import { shortcutHint } from '#/tui/utils/os-shortcuts';

// Toolbar tips — rotates every 10s. Most tips are short and pair up (two
// joined by " | ") when space allows; tips flagged `solo` are long or
// important enough to take the whole slot on their own. A `priority` weight
// makes a tip recur more often in the rotation (default 1). Width is always
// the final arbiter (a pair that doesn't fit falls back to its first tip).
const TIP_ROTATE_INTERVAL_MS = 10_000;
const TIP_SEPARATOR = ' | ';

/**
 * Expand tips into a rotation sequence using smooth weighted round-robin
 * (the nginx SWRR algorithm). Higher-`priority` tips appear more often while
 * staying evenly spread, so a tip generally does not land next to its own
 * duplicate. Deterministic and computed once at module load. Exported for
 * unit testing.
 */
export function buildWeightedTips(tips: readonly ToolbarTip[]): readonly ToolbarTip[] {
  const items = tips.map((t) => ({
    tip: t,
    weight: Math.max(1, Math.trunc(t.priority ?? 1)),
    current: 0,
  }));
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  const seq: ToolbarTip[] = [];
  for (let n = 0; n < total; n++) {
    let best = items[0]!;
    for (const it of items) {
      it.current += it.weight;
      if (it.current > best.current) best = it;
    }
    best.current -= total;
    seq.push(best.tip);
  }
  return seq;
}

const ROTATION: readonly ToolbarTip[] = buildWeightedTips(ALL_TIPS);

/**
 * Per-session starting offset so two sessions do not open on the same tip.
 * Picked once at module load; the wall clock seeds variety here and never
 * advances the rotation itself (see `tipRotationIndex`).
 */
const ROTATION_SEED = Math.floor(Date.now() / TIP_ROTATE_INTERVAL_MS);

/**
 * Rotation counter for the shared motion clock (PREMIUM.md §7.1).
 *
 * Rotating on `Date.now()` gave the tips their own clock: it kept advancing
 * while the render loop was paused and ignored the calm-idle freeze, so an
 * otherwise byte-identical idle frame changed every 10s and forced a repaint
 * on unstable transports.
 */
export function tipRotationIndex(nowMs: number = appearanceAnimationNow()): number {
  return ROTATION_SEED + Math.floor(Math.max(0, nowMs) / TIP_ROTATE_INTERVAL_MS);
}

/**
 * Pick the tip(s) for a rotation index over the weighted ROTATION sequence.
 * `primary` is always shown when it fits; `pair` (primary + next tip joined
 * by the separator) is offered for wide terminals. Pairing is skipped when
 * the current/next tip is `solo` or when the neighbour is a duplicate of the
 * current tip (which can happen at the wrap boundary), keeping long/important
 * tips on their own and avoiding "X | X".
 */
export function tipsForIndex(index: number): { primary: string; pair: string | null } {
  const n = ROTATION.length;
  if (n === 0) return { primary: '', pair: null };
  const offset = ((index % n) + n) % n;
  const current = ROTATION[offset]!;
  const currentText = shortcutHint(current.key);
  if (n === 1 || current.solo) return { primary: currentText, pair: null };
  const next = ROTATION[(offset + 1) % n]!;
  const nextText = shortcutHint(next.key);
  if (next.solo || next.key === current.key) return { primary: currentText, pair: null };
  return { primary: currentText, pair: currentText + TIP_SEPARATOR + nextText };
}

/** Current toolbar tip rotation index (10s cadence on the shared motion clock). */
export function footerCurrentTipIndex(): number {
  return tipRotationIndex();
}
