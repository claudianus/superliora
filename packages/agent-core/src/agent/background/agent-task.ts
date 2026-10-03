import { errorMessage, isAbortError } from '../../loop/errors';
import {
  type BackgroundTask,
  type BackgroundTaskInfoBase,
  type BackgroundTaskSink,
} from './task';
import type { SessionSubagentHost, SubagentHandle } from '../../session/subagent/subagent-host';

export interface AgentBackgroundTaskInfo extends BackgroundTaskInfoBase {
  readonly kind: 'agent';
  /** Identifier accepted by SessionControl message/wait/stop. */
  readonly agentId?: string;
  /** Worker profile identifier. */
  readonly subagentType?: string;
}

export class AgentBackgroundTask implements BackgroundTask {
  readonly kind = 'agent' as const;
  readonly idPrefix: string = 'agent';
  readonly agentId: string;
  readonly subagentType: string;

  constructor(
    private readonly handle: SubagentHandle,
    readonly description: string,
    private readonly subagentHost: Pick<SessionSubagentHost, 'markActiveChildDetached' | 'stopAndJoin'>,
    private readonly abortController: AbortController,
  ) {
    this.agentId = handle.agentId;
    this.subagentType = handle.profileName;
  }

  get resourcesSettled(): boolean | undefined {
    return this.handle.resourcesSettled;
  }

  async forceStop(): Promise<void> {
    await this.subagentHost.stopAndJoin(this.agentId);
  }

  async start(sink: BackgroundTaskSink): Promise<void> {
    const requestAbort = (): void => {
      this.abortController.abort(sink.signal.reason);
    };
    if (sink.signal.aborted) {
      requestAbort();
    } else {
      sink.signal.addEventListener('abort', requestAbort, { once: true });
    }

    try {
      const outcome = await this.handle.completion;
      sink.appendOutput(JSON.stringify(outcome));
      await sink.settle({ status: 'completed' });
    } catch (error: unknown) {
      if (sink.signal.aborted && (isAbortError(error) || error === sink.signal.reason)) {
        await sink.settle({ status: 'killed' });
        return;
      }
      await sink.settle({ status: 'failed', stopReason: errorMessage(error) });
    } finally {
      sink.signal.removeEventListener('abort', requestAbort);
    }
  }

  onDetach(): void {
    this.subagentHost.markActiveChildDetached(this.agentId);
  }

  toInfo(base: BackgroundTaskInfoBase): AgentBackgroundTaskInfo {
    return {
      ...base,
      kind: 'agent',
      agentId: this.agentId,
      subagentType: this.subagentType,
    };
  }
}
