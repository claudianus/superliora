import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';
import { appearanceAnimationNow, isToneSettleFlashActive } from '#/tui/features/appearance/appearance-effects';
import { computeStagedLineReveal } from '#/tui/utils/streaming/streaming-text-reveal';
import {
  isTranscriptEntranceActive,
  toolHeaderEntranceDurationMs,
} from '#/tui/features/transcript/transcript-entrance';
import { BRAILLE_SPINNER_FRAMES } from '#/tui/constant/rendering';

import {
  hasPreviewRevealStarted,
  peekPreviewRevealStartedAt,
  stagedPreviewRevealDurationMs,
} from './entrance';
import { SUBAGENT_ELAPSED_INTERVAL_MS, type SubagentPhase } from './subagent';

const STREAMING_PROGRESS_INTERVAL_MS = 1000;

export interface ToolCallRenderTickInput {
  readonly toolCall: ToolCallBlockData;
  readonly result: ToolResultBlockData | undefined;
  readonly previewRevealEligible: boolean;
  readonly previewItemTotal: number;
  readonly builtPreviewItemCount: number;
  readonly lastStreamingProgressTickMs: number;
  readonly lastSubagentElapsedTickMs: number;
  readonly entranceStartedAtMs: number;
  readonly resultSettledAtMs: number | undefined;
  readonly isSingleSubagentView: boolean;
  readonly derivedSubagentPhase: SubagentPhase | undefined;
  readonly isStreamingEditPreview: boolean;
  readonly subagentSpawnEntranceAtMs: number | undefined;
  readonly subagentStartedAtMs: number | undefined;
  readonly subagentPhase: SubagentPhase;
  readonly subagentOngoingSubCallsSize: number;
}

export interface ToolCallRenderTickCallbacks {
  readonly rebuildCallPreviewBlock: () => void;
  readonly rebuildBody: () => void;
  readonly rebuildSubagentBlock: () => void;
  readonly refreshHeader: () => void;
  readonly notifySnapshotChange: () => void;
  readonly requestRender: () => void;
  readonly setLastStreamingProgressTickMs: (ms: number) => void;
  readonly setLastSubagentElapsedTickMs: (ms: number) => void;
  readonly setSubagentSpinnerFrame: (frame: number) => void;
  readonly getSubagentSpinnerFrame: () => number;
}

export function isPreviewRevealActive(input: Pick<
  ToolCallRenderTickInput,
  'previewRevealEligible' | 'previewItemTotal' | 'builtPreviewItemCount' | 'toolCall'
>): boolean {
  if (!input.previewRevealEligible || input.previewItemTotal <= 1) return false;
  if (input.builtPreviewItemCount >= input.previewItemTotal) return false;
  const durationMs = stagedPreviewRevealDurationMs();
  if (durationMs <= 0) return false;
  return hasPreviewRevealStarted(input.toolCall.id);
}

export function hasToolCallLiveAnimation(input: ToolCallRenderTickInput): boolean {
  if (input.result === undefined) return true;
  if (input.isSingleSubagentView) {
    const phase = input.derivedSubagentPhase;
    if (phase === 'queued' || phase === 'spawning' || phase === 'running') return true;
  }
  if (
    input.resultSettledAtMs !== undefined &&
    isToneSettleFlashActive(input.resultSettledAtMs)
  ) {
    return true;
  }
  if (isPreviewRevealActive(input)) return true;
  return isTranscriptEntranceActive(input.entranceStartedAtMs);
}

export function tickToolCallRenderClock(
  input: ToolCallRenderTickInput,
  callbacks: ToolCallRenderTickCallbacks,
): void {
  const now = appearanceAnimationNow();

  if (isPreviewRevealActive(input)) {
    const startedAtMs = peekPreviewRevealStartedAt(input.toolCall.id) ?? now;
    const visible = computeStagedLineReveal({
      totalLines: input.previewItemTotal,
      elapsedMs: now - startedAtMs,
      durationMs: stagedPreviewRevealDurationMs(),
    });
    if (visible !== input.builtPreviewItemCount) {
      callbacks.rebuildCallPreviewBlock();
      callbacks.requestRender();
    }
  }

  const shouldTickToolProgress =
    input.isStreamingEditPreview ||
    (input.result === undefined && input.toolCall.streamingStartedAtMs !== undefined);
  if (shouldTickToolProgress) {
    if (now - input.lastStreamingProgressTickMs >= STREAMING_PROGRESS_INTERVAL_MS) {
      callbacks.setLastStreamingProgressTickMs(now);
      if (input.isStreamingEditPreview) {
        callbacks.rebuildBody();
      } else {
        callbacks.refreshHeader();
      }
      callbacks.requestRender();
    }
  } else {
    callbacks.setLastStreamingProgressTickMs(0);
  }

  const phase = input.derivedSubagentPhase;
  const spawnEntranceAtMs = input.subagentSpawnEntranceAtMs;
  const spawnEntranceLive =
    spawnEntranceAtMs !== undefined &&
    now - spawnEntranceAtMs <= toolHeaderEntranceDurationMs() * 2;
  const subagentShouldTick = input.isSingleSubagentView
    ? input.subagentStartedAtMs !== undefined &&
      (phase === 'queued' || phase === 'spawning' || phase === 'running')
    : input.subagentPhase === 'queued' ||
      input.subagentPhase === 'spawning' ||
      input.subagentPhase === 'running' ||
      input.subagentOngoingSubCallsSize > 0 ||
      spawnEntranceLive;
  if (subagentShouldTick) {
    if (now - input.lastSubagentElapsedTickMs >= SUBAGENT_ELAPSED_INTERVAL_MS) {
      callbacks.setLastSubagentElapsedTickMs(now);
      callbacks.setSubagentSpinnerFrame(
        (callbacks.getSubagentSpinnerFrame() + 1) % BRAILLE_SPINNER_FRAMES.length,
      );
      callbacks.refreshHeader();
      callbacks.rebuildSubagentBlock();
      callbacks.notifySnapshotChange();
      callbacks.requestRender();
    }
  } else {
    callbacks.setLastSubagentElapsedTickMs(0);
  }
}
