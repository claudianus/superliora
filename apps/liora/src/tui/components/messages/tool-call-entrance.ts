/**
 * First-seen entrance / preview-reveal registries for ToolCallComponent.
 * Streaming remounts and clock-driven rebuilds must not restart these clocks.
 * Subagent spawn entrance lives in tool-call-subagent.ts.
 */

import {
  STAGED_LINE_REVEAL_MS_PREMIUM,
  STAGED_LINE_REVEAL_MS_SUBTLE,
} from '#/tui/constant/streaming';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { TOOL_HEADER_ENTRANCE_MS } from '#/tui/utils/transcript-entrance';

/**
 * First-seen header timestamps keyed by toolCallId. Streaming deltas can
 * remount a ToolCallComponent (see `streamingShellPreview`), which would
 * restart a per-instance entrance clock every frame and read as flicker —
 * the registry pins the entrance start to the first render of each tool call.
 * Swept once it outgrows the live window so long sessions stay bounded.
 */
const toolHeaderFirstSeenMs = new Map<string, number>();
const TOOL_HEADER_FIRST_SEEN_MAX_ENTRIES = 128;

export function toolHeaderEntranceStartedAt(toolCallId: string): number {
  const now = appearanceAnimationNow();
  if (toolHeaderFirstSeenMs.size >= TOOL_HEADER_FIRST_SEEN_MAX_ENTRIES) {
    // Generous expiry: the longest subtle-mode entrance plus margin.
    const ttl = TOOL_HEADER_ENTRANCE_MS * 4;
    for (const [id, seen] of toolHeaderFirstSeenMs) {
      if (now - seen > ttl) toolHeaderFirstSeenMs.delete(id);
    }
  }
  let seen = toolHeaderFirstSeenMs.get(toolCallId);
  if (seen === undefined) {
    seen = now;
    toolHeaderFirstSeenMs.set(toolCallId, seen);
  }
  return seen;
}

/**
 * First-seen timestamps for the staged preview reveal keyed by toolCallId.
 * The settled Write/Edit preview is rebuilt whenever streaming args finalize
 * or the result lands; the registry pins the reveal start to the first
 * settled build so those rebuilds grow the preview in place instead of
 * replaying the entrance. Same bounded-map sweep as the header registry.
 */
const previewRevealFirstSeenMs = new Map<string, number>();
const PREVIEW_REVEAL_FIRST_SEEN_MAX_ENTRIES = 128;

export function previewRevealStartedAt(toolCallId: string): number {
  const now = appearanceAnimationNow();
  if (previewRevealFirstSeenMs.size >= PREVIEW_REVEAL_FIRST_SEEN_MAX_ENTRIES) {
    // Generous expiry: the longest subtle-mode reveal plus margin.
    const ttl = STAGED_LINE_REVEAL_MS_SUBTLE * 4;
    for (const [id, seen] of previewRevealFirstSeenMs) {
      if (now - seen > ttl) previewRevealFirstSeenMs.delete(id);
    }
  }
  let seen = previewRevealFirstSeenMs.get(toolCallId);
  if (seen === undefined) {
    seen = now;
    previewRevealFirstSeenMs.set(toolCallId, seen);
  }
  return seen;
}

/** Read-only peek — does not register a first-seen timestamp. */
export function peekPreviewRevealStartedAt(toolCallId: string): number | undefined {
  return previewRevealFirstSeenMs.get(toolCallId);
}

export function hasPreviewRevealStarted(toolCallId: string): boolean {
  return previewRevealFirstSeenMs.has(toolCallId);
}

/** Staged preview reveal TTL (0 when ambient motion is off; subtle stretches). */
export function stagedPreviewRevealDurationMs(): number {
  const appearance = getActiveAppearancePreferences();
  if (!shouldRenderAmbientEffects(appearance)) return 0;
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  return mode === 'subtle' ? STAGED_LINE_REVEAL_MS_SUBTLE : STAGED_LINE_REVEAL_MS_PREMIUM;
}
