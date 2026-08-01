/**
 * Compaction LLM call guards — per-request wall-clock timeout + stream idle.
 *
 * kosong only idle-times the *stream* after `provider.generate()` resolves.
 * A hung TCP/TLS handshake or a provider that never returns a stream can
 * therefore freeze compaction forever, leaving `FullCompaction.compacting`
 * set and every subsequent turn blocked at the trigger threshold. These
 * helpers bound every compaction generate call so the worker always exits.
 */

import { APITimeoutError, type ChatProvider, type GenerateResult, type Tool } from '@superliora/kosong';

import { createDeadlineAbortSignal } from '../../../utils/abort';
import type { CompactionPipelineContext, CompactionStreamMeta } from './types';
import { compactionStreamCallbacks } from './progress';

/** Per-call wall-clock budget for one compaction generate (summarize/merge/repair). */
export const DEFAULT_COMPACTION_GENERATE_TIMEOUT_MS = 90_000;
export const COMPACTION_GENERATE_TIMEOUT_ENV = 'SUPERLIORA_COMPACTION_GENERATE_TIMEOUT_MS';

/** Whole-worker budget so multi-round / multi-block runs cannot hang forever. */
export const DEFAULT_COMPACTION_WORKER_TIMEOUT_MS = 600_000;
export const COMPACTION_WORKER_TIMEOUT_ENV = 'SUPERLIORA_COMPACTION_WORKER_TIMEOUT_MS';

/**
 * Tighter stream idle than the global 2-minute LLM default: compaction summaries
 * are short; a silent gateway should fail over to classical extractive backstop
 * rather than hold the session lock for minutes.
 */
export const DEFAULT_COMPACTION_STREAM_IDLE_MS = 60_000;

/** Static empty tool list for compaction generate calls. */
export const COMPACTION_GENERATE_TOOLS: Tool[] = [];

export function resolveCompactionGenerateTimeoutMs(
  explicit?: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const raw = env[COMPACTION_GENERATE_TIMEOUT_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_COMPACTION_GENERATE_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_COMPACTION_GENERATE_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

export function resolveCompactionWorkerTimeoutMs(
  explicit?: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const raw = env[COMPACTION_WORKER_TIMEOUT_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_COMPACTION_WORKER_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_COMPACTION_WORKER_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

export function compactionGenerateOptions(
  ctx: CompactionPipelineContext,
  signal: AbortSignal,
): {
  readonly signal: AbortSignal;
  readonly runtimeModelAlias?: string;
  readonly streamIdleTimeoutMs: number;
} {
  return {
    signal,
    runtimeModelAlias: ctx.compactionModelAlias,
    streamIdleTimeoutMs: DEFAULT_COMPACTION_STREAM_IDLE_MS,
  };
}

/**
 * Run one compaction generate under a wall-clock deadline linked to `signal`.
 * On timeout, throws {@link APITimeoutError} (retryable + classical-fallback
 * eligible) instead of a bare AbortError so the summarize path can fall back
 * to the extractive backstop rather than silently cancelling.
 */
export async function runCompactionGenerate(
  ctx: CompactionPipelineContext,
  signal: AbortSignal,
  input: {
    readonly provider: ChatProvider;
    readonly messages: Parameters<CompactionPipelineContext['agent']['generate']>[3];
    readonly streamMeta: CompactionStreamMeta;
    readonly timeoutMs?: number;
  },
): Promise<GenerateResult> {
  const timeoutMs = resolveCompactionGenerateTimeoutMs(input.timeoutMs);
  const deadline = createDeadlineAbortSignal(signal, timeoutMs);
  try {
    return await ctx.agent.generate(
      input.provider,
      ctx.agent.config.systemPrompt,
      COMPACTION_GENERATE_TOOLS,
      input.messages,
      compactionStreamCallbacks(ctx.agent, input.streamMeta),
      compactionGenerateOptions(ctx, deadline.signal),
    );
  } catch (error) {
    if (deadline.timedOut()) {
      throw new APITimeoutError(
        `Compaction generate timed out after ${String(timeoutMs)}ms without a complete response.`,
      );
    }
    throw error;
  } finally {
    deadline.clear();
  }
}
