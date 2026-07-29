/**
 * Compaction progress/streaming helpers.
 *
 * Extracted from full.ts — emits `compaction.progress` events so the TUI
 * can render live summary text and phase-aware progress bars.
 */

import type { Agent } from '../..';
import {
  PROGRESS_WEIGHT_BLOCKS,
  PROGRESS_WEIGHT_FINALIZE,
  PROGRESS_WEIGHT_MERGE,
  PROGRESS_WEIGHT_PLAN,
  PROGRESS_WEIGHT_REPAIR,
  type CompactionProgressMeta,
  type CompactionStreamMeta,
} from './types';

/**
 * Stream every compaction LLM call into `compaction.progress` so TUI can
 * show live summary text (main, parallel blocks, merge, and repair).
 *
 * `blocksCompleted` and `fraction` accept getters because parallel blocks
 * run concurrently: a snapshot taken when the callback is created goes stale
 * the moment another block finishes, and the slow block's next delta would
 * rewind the TUI's "block n/N" counter. Getters are resolved at emit time,
 * so every delta carries the live count.
 */
export function compactionStreamCallbacks(
  agent: Agent,
  meta: CompactionStreamMeta,
): {
  readonly onMessagePart: (part: {
    readonly type: string;
    readonly text?: string;
  }) => void;
} {
  return {
    onMessagePart: (part) => {
      if (part.type !== 'text') return;
      const text = part.text ?? '';
      if (text.length === 0) return;
      agent.emitEvent({
        type: 'compaction.progress',
        phase: meta.phase,
        streamKind: meta.streamKind,
        blockIndex: meta.blockIndex,
        blockCount: meta.blockCount,
        blocksCompleted:
          typeof meta.blocksCompleted === 'function'
            ? meta.blocksCompleted()
            : meta.blocksCompleted,
        fraction: typeof meta.fraction === 'function' ? meta.fraction() : meta.fraction,
        delta: text,
      });
    },
  };
}

/** Emit a non-stream progress tick (phase / block completion / fraction). */
export function emitCompactionProgress(agent: Agent, meta: CompactionProgressMeta): void {
  agent.emitEvent({
    type: 'compaction.progress',
    phase: meta.phase,
    streamKind: meta.streamKind,
    blockIndex: meta.blockIndex,
    blockCount: meta.blockCount,
    blocksCompleted: meta.blocksCompleted,
    fraction: meta.fraction,
    blockDurationMs: meta.blockDurationMs,
    blockTokens: meta.blockTokens,
  });
}

/**
 * Map parallel-block completion into the summarizing band of overall progress.
 * plan(5%) + blocks(55% * done/N) — merge/repair/finalize advance later.
 */
export function fractionForBlocksCompleted(blocksCompleted: number, blockCount: number): number {
  if (blockCount <= 0) return PROGRESS_WEIGHT_PLAN;
  const done = Math.max(0, Math.min(blocksCompleted, blockCount));
  return PROGRESS_WEIGHT_PLAN + PROGRESS_WEIGHT_BLOCKS * (done / blockCount);
}

export function fractionForMergeStart(blockCount: number): number {
  return fractionForBlocksCompleted(blockCount, blockCount);
}

export function fractionForMergeDone(): number {
  return PROGRESS_WEIGHT_PLAN + PROGRESS_WEIGHT_BLOCKS + PROGRESS_WEIGHT_MERGE;
}

export function fractionForRepairDone(): number {
  return fractionForMergeDone() + PROGRESS_WEIGHT_REPAIR;
}

export function fractionForFinalizing(): number {
  return fractionForRepairDone() + PROGRESS_WEIGHT_FINALIZE * 0.5;
}
