import type { ExecutableTool } from '../../loop';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../tools/store';
import type { Agent } from '..';
import { buildBuiltinTools } from './builtin-tools';
import { cancelShellCommand, runShellCommand } from './shell-command';
import type { BuiltinTool } from './types';
import { scheduleJobLedgerCrashMirror } from '../../tools/builtin/job/job-crash-mirror';
import { scheduleWorkspaceCatalogSync } from '../../tools/builtin/job/job-workspace-bind';

/**
 * Coalescing window for job.ledger wire records. The
 * ledger is written whole on every patch; patch storms (progress mirroring,
 * steer loops) only need the latest snapshot to survive.
 */
const JOB_LEDGER_WIRE_FLUSH_MS = 500;

export * from './types';

export class ToolManager {
  builtinTools: Map<string, BuiltinTool> = new Map();
  protected readonly store: Partial<ToolStoreData> = {};
  /** Deferred job_ledger wire flush (coalescing window, latest-wins). */
  private pendingLedgerWireFlush: NodeJS.Timeout | undefined;
  private readonly storeView: ToolStore = {
    get: (key) => this.store[key],
    set: (key, value) => this.updateStore(key, value),
  };
  private executableTools: readonly ExecutableTool[] = [];

  /** Abort controllers for in-flight `!` shell commands, keyed by commandId so
   *  the TUI can cancel (Esc / Ctrl+C) a running command. */
  readonly shellCommandControllers = new Map<string, AbortController>();

  constructor(readonly agent: Agent) {
    this.initializeBuiltinTools();
  }

  get toolStore(): ToolStore {
    return this.storeView;
  }


  getStore(): ToolStore {
    return this.toolStore;
  }

  updateStore<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
    this.store[key] = value;
    if (!this.agent.records.restoring) this.logStoreUpdateRecord(key);
    if (key === 'job_ledger' && !this.agent.records.restoring) {
      scheduleJobLedgerCrashMirror(this.toolStore);
      scheduleWorkspaceCatalogSync(this.toolStore);
    }
  }

  private logStoreUpdateRecord(key: ToolStoreKey): void {
    if (key !== 'job_ledger') {
      this.appendStoreUpdateRecord(key);
      return;
    }
    if (this.pendingLedgerWireFlush !== undefined) return;
    this.pendingLedgerWireFlush = setTimeout(() => {
      this.pendingLedgerWireFlush = undefined;
      this.appendStoreUpdateRecord('job_ledger');
    }, JOB_LEDGER_WIRE_FLUSH_MS);
    this.pendingLedgerWireFlush.unref();
  }

  flushRecordWrites(): void {
    if (this.pendingLedgerWireFlush === undefined) return;
    clearTimeout(this.pendingLedgerWireFlush);
    this.pendingLedgerWireFlush = undefined;
    this.appendStoreUpdateRecord('job_ledger');
  }

  private appendStoreUpdateRecord(key: ToolStoreKey): void {
    switch (key) {
      case 'job_ledger':
        if (this.store.job_ledger !== undefined) this.agent.records.logRecord({ type: 'job.ledger', ledger: this.store.job_ledger });
        return;
      case 'job_inbox':
        if (this.store.job_inbox !== undefined) this.agent.records.logRecord({ type: 'job.inbox', inbox: this.store.job_inbox });
        return;
      case 'job_project_mode':
        if (this.store.job_project_mode !== undefined) this.agent.records.logRecord({ type: 'job.pool', pool: this.store.job_project_mode });
        return;
    }
  }

  /**
   * Execute a user-initiated `!` shell command. Reuses the builtin Bash tool
   * (same kaos / cwd / BackgroundManager as the agent), recording the command
   * and its output as `shell_command`-origin messages. It does NOT start a turn
   * — the model is not prompted (parity with claude-code's `shouldQuery: false`).
   */
  async runShellCommand(
    command: string,
    commandId?: string,
  ): Promise<{ stdout: string; stderr: string; isError?: boolean; backgrounded?: boolean }> {
    return runShellCommand(this, command, commandId);
  }

  cancelShellCommand(commandId: string): void {
    cancelShellCommand(this.shellCommandControllers, commandId);
  }




  initializeBuiltinTools() {
    this.builtinTools = buildBuiltinTools(this);
    this.executableTools = Array.from(this.builtinTools.values());
  }

  refreshBuiltinTools(): void {
    this.initializeBuiltinTools();
  }

  get loopTools(): readonly ExecutableTool[] {
    return this.executableTools;
  }

}
