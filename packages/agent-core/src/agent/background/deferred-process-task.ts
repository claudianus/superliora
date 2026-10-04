import type { KaosProcess } from '@superliora/kaos';

import { registerSessionWorktreeOwnershipGuard, sessionWorktreeContainsPath } from '../../session/worktree';
import { ProcessBackgroundTask, type ProcessBackgroundTaskInfo } from './process-task';
import type { BackgroundTask, BackgroundTaskInfoBase, BackgroundTaskSink } from './task';

/** Manager-owned admission: preparation cannot begin on the accepting call stack. */
export class DeferredProcessBackgroundTask implements BackgroundTask {
  readonly kind = 'process' as const;
  readonly idPrefix = 'bash';
  private processTask: ProcessBackgroundTask | undefined;
  private phase: 'accepted' | 'preparing' | 'running' = 'accepted';
  private settled = false;
  // The manager escalates at most once; a spawn still pending at that moment
  // must receive the escalation when its process is adopted.
  private forceStopRequested = false;
  private readonly releaseOwnership: () => void;

  constructor(
    readonly command: string,
    readonly description: string,
    readonly cwd: string,
    private readonly prepare: (signal: AbortSignal) => Promise<KaosProcess>,
  ) {
    this.releaseOwnership = registerSessionWorktreeOwnershipGuard((path) =>
      !this.resourcesSettled && sessionWorktreeContainsPath(path, this.cwd));
  }

  /** Registration failed before the manager took ownership. */
  abandonAdmission(): void {
    this.settled = true;
    this.releaseOwnership();
  }

  get resourcesSettled(): boolean {
    return this.processTask?.resourcesSettled ?? this.settled;
  }

  async start(sink: BackgroundTaskSink): Promise<void> {
    // Not a microtask: the acceptance promise must resolve before any expensive
    // readiness/probe work, including synchronous work inside an async factory.
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    try {
      if (this.settled) throw new Error('Background admission was abandoned.');
      sink.signal.throwIfAborted();
      this.phase = 'preparing';
      const proc = await this.prepare(sink.signal);
      // A stop during spawn must still adopt and join the returned process.
      this.processTask = new ProcessBackgroundTask(proc, this.command, this.description, this.cwd);
      this.phase = 'running';
      const started = this.processTask.start(sink);
      if (this.forceStopRequested) await this.processTask.forceStop().catch(() => undefined);
      await started;
    } finally {
      this.settled = true;
      if (this.resourcesSettled) this.releaseOwnership();
    }
  }

  async forceStop(): Promise<void> {
    this.forceStopRequested = true;
    await this.processTask?.forceStop();
    if (this.resourcesSettled) this.releaseOwnership();
  }

  toInfo(base: BackgroundTaskInfoBase): ProcessBackgroundTaskInfo {
    return {
      ...(this.processTask?.toInfo(base) ?? {
        ...base, kind: this.kind, command: this.command, cwd: this.cwd, exitCode: null,
      }),
      executionPhase: this.phase,
    };
  }
}
