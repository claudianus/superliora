import { createHash } from 'node:crypto';
import type { Agent } from '../..';
import { ErrorCodes, LioraError, makeErrorPayload } from '#/errors/index';
import type { CompactionBeginData } from '../types';

export class FullCompaction {
  private active: { controller: AbortController; promise: Promise<void> } | undefined;

  constructor(readonly agent: Agent) {}

  get isCompacting(): boolean {
    return this.active !== undefined;
  }

  getEffectiveMaxContextTokens(): number {
    return this.agent.config.modelCapabilities.max_context_tokens ?? 0;
  }

  begin(data: Readonly<CompactionBeginData>): void {
    if (this.active !== undefined) throw new LioraError(ErrorCodes.COMPACTION_UNABLE, 'Compaction is already running.');
    if (data.source === 'manual' && this.agent.turn.hasActiveTurn) {
      throw new LioraError(ErrorCodes.COMPACTION_UNABLE, 'Wait for the active turn to finish before compacting.');
    }
    if (this.agent.records.restoring) {
      this.agent.replayBuilder.push({ type: 'compaction', instruction: data.instruction });
      return;
    }
    const prefix = this.agent.context.completedHistorySnapshot();
    const count = prefix.length;
    if (count === 0) throw new LioraError(ErrorCodes.COMPACTION_UNABLE, 'No completed conversation prefix to compact.');
    const fingerprint = prefixFingerprint(prefix, count);
    const tokensBefore = this.agent.context.tokenCountWithPending;
    const controller = new AbortController();
    const active: { controller: AbortController; promise: Promise<void> } = {
      controller,
      promise: Promise.resolve()
        .then(() => this.run(data, count, prefix, fingerprint, tokensBefore, controller.signal))
        .finally(() => { if (this.active === active) this.active = undefined; }),
    };
    this.active = active;
    this.agent.records.logRecord({ type: 'full_compaction.begin', source: data.source, instruction: data.instruction });
    this.agent.emitEvent({ type: 'compaction.started', trigger: data.source, instruction: data.instruction, mode: 'blocking', modelAlias: this.agent.config.modelAlias });
    void active.promise.catch((error: unknown) => {
      if (controller.signal.aborted) this.agent.emitEvent({ type: 'compaction.cancelled' });
      else this.agent.emitEvent({ type: 'error', ...makeErrorPayload(ErrorCodes.COMPACTION_FAILED, error instanceof Error ? error.message : String(error)) });
    });
  }

  async waitUntilSettled(): Promise<boolean> {
    const active = this.active;
    if (active === undefined) return false;
    await active.promise;
    return true;
  }

  cancel(): void {
    this.active?.controller.abort();
    if (this.agent.records.restoring) this.agent.replayBuilder.patchLast('compaction', { result: 'cancelled' });
  }

  private async run(
    data: Readonly<CompactionBeginData>,
    compactedCount: number,
    prefix: readonly (typeof this.agent.context.history)[number][],
    fingerprint: string,
    tokensBefore: number,
    signal: AbortSignal,
  ): Promise<void> {
    let summary = data.summary;
    if (summary === undefined) {
      const result = await this.agent.generate(
        this.agent.config.provider,
        data.instruction ?? 'Summarize this conversation so the same task can continue. Preserve the user intent, current state and decisions. Return the summary only.',
        [],
        this.agent.context.projectForCompaction(prefix),
        { onMessagePart: (part) => {
          if (part.type === 'text') this.agent.emitEvent({ type: 'compaction.progress', phase: 'summarizing', streamKind: 'summary', delta: part.text });
        } },
        { signal },
      );
      summary = '';
      for (const part of result.message.content) if (part.type === 'text') summary += part.text;
      if (result.usage !== null) this.agent.usage.record(this.agent.config.model, result.usage);
    }
    signal.throwIfAborted();
    if (summary.trim().length === 0) throw new LioraError(ErrorCodes.COMPACTION_FAILED, 'The model returned an empty conversation summary.');
    if (this.agent.context.history.length < compactedCount || prefixFingerprint(this.agent.context.history, compactedCount) !== fingerprint) {
      throw new LioraError(ErrorCodes.COMPACTION_UNABLE, 'Conversation changed while compaction was running.');
    }
    const result = this.agent.context.applyCompaction({ summary, compactedCount, tokensBefore });
    this.agent.records.logRecord({ type: 'full_compaction.complete' });
    this.agent.emitEvent({ type: 'compaction.completed', result });
  }
}

function prefixFingerprint(history: readonly unknown[], count: number): string {
  const hash = createHash('sha256');
  for (let index = 0; index < count; index++) hash.update(JSON.stringify(history[index]));
  return hash.digest('hex');
}
