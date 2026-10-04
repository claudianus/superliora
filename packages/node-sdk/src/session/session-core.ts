/**
 * Session lifecycle, user input, native execution, and explicit context control.
 */

import {
  ErrorCodes,
  LioraError,
  type AgentContextData,
  type ContextComposition,
  type PermissionMode,
  type TurnCancelSource,
} from '@superliora/agent-core';

import { type ApprovalHandler, type Event, type QuestionHandler, type CredentialHandler } from '#/session/events';
import type { SDKRpcClientBase } from '#/rpc/rpc';
import {
  isKnownThinkingLevel,
  isPermissionMode,
  normalizeOptionalString,
  normalizePromptInput,
  normalizeRequiredString,
  resumeStateFromSummary,
} from '#/session/session-helpers';
import type {
  AddAdditionalDirOptions,
  AddAdditionalDirResult,
  CompactOptions,
  PromptInput,
  ResumedSessionState,
  ResumedSessionSummary,
  SessionStatus,
  SessionTrace,
  SessionSummary,
  SessionUsage,
  Unsubscribe,
} from '#/session/types';

const MAIN_AGENT_ID = 'main';

export interface SessionOptions {
  readonly id: string;
  readonly workDir: string;
  readonly summary?: SessionSummary | undefined;
  readonly resumeState?: ResumedSessionState | undefined;
  readonly rpc: SDKRpcClientBase;
  readonly onClose?: (() => void | Promise<void>) | undefined;
}

export abstract class SessionCore {
  readonly id: string;
  readonly workDir: string;
  protected _summary: SessionSummary | undefined;
  protected resumeState: ResumedSessionState | undefined;

  protected readonly rpc: SDKRpcClientBase;
  protected readonly onClose?: (() => void | Promise<void>) | undefined;
  protected readonly eventUnsubscribers: Array<() => void> = [];
  protected closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.workDir = options.workDir;
    this._summary = options.summary;
    this.resumeState = options.resumeState ?? resumeStateFromSummary(options.summary);
    this.rpc = options.rpc;
    this.onClose = options.onClose;
  }

  get summary(): SessionSummary | undefined {
    return this._summary;
  }

  getResumeState(): ResumedSessionState | undefined {
    this.ensureOpen();
    return this.resumeState;
  }

  async reloadSession(): Promise<ResumedSessionSummary> {
    this.ensureOpen();
    const summary = await this.rpc.reloadSession({ sessionId: this.id });
    this._summary = summary;
    this.resumeState = resumeStateFromSummary(summary);
    return summary;
  }

  onEvent(listener: (event: Event) => void): Unsubscribe {
    this.ensureOpen();
    const unsubscribe = this.rpc.onEvent((event) => {
      if (event.sessionId === this.id) {
        listener(event);
      }
    });
    // Track subscriptions so close() can release them automatically.
    this.eventUnsubscribers.push(unsubscribe);
    return () => {
      const idx = this.eventUnsubscribers.indexOf(unsubscribe);
      if (idx !== -1) this.eventUnsubscribers.splice(idx, 1);
      unsubscribe();
    };
  }

  setApprovalHandler(handler: ApprovalHandler | undefined): void {
    this.ensureOpen();
    this.rpc.setApprovalHandler(this.id, handler);
  }

  setQuestionHandler(handler: QuestionHandler | undefined): void {
    this.ensureOpen();
    this.rpc.setQuestionHandler(this.id, handler);
  }

  setCredentialHandler(handler: CredentialHandler | undefined): void {
    this.ensureOpen();
    this.rpc.setCredentialHandler(this.id, handler);
  }

  async prompt(input: string | PromptInput): Promise<void> {
    this.ensureOpen();
    await this.rpc.prompt({
      sessionId: this.id,
      input: normalizePromptInput(input),
    });
  }

  /** Execute a user-initiated `!` shell command (silent — does not prompt the
   *  model). Resolves with the command's stdout/stderr for immediate display.
   *  Pass `commandId` to receive live `shell.output` events for this command. */
  async runShellCommand(
    command: string,
    options?: { commandId?: string },
  ): Promise<{ stdout: string; stderr: string; isError?: boolean; backgrounded?: boolean }> {
    this.ensureOpen();
    return this.rpc.runShellCommand({
      sessionId: this.id,
      command,
      commandId: options?.commandId,
    });
  }

  /** Cancel a running `!` shell command by its commandId (e.g. on Esc / Ctrl+C). */
  async cancelShellCommand(commandId: string): Promise<void> {
    this.ensureOpen();
    return this.rpc.cancelShellCommand({ sessionId: this.id, commandId });
  }

  async steer(input: string | PromptInput): Promise<void> {
    this.ensureOpen();
    await this.rpc.steer({
      sessionId: this.id,
      input: normalizePromptInput(input),
    });
  }


  async getSessionWarnings() {
    this.ensureOpen();
    return this.rpc.getSessionWarnings({ sessionId: this.id });
  }

  async addAdditionalDir(
    path: string,
    options?: AddAdditionalDirOptions,
  ): Promise<AddAdditionalDirResult> {
    this.ensureOpen();
    const normalized = normalizeRequiredString(
      path,
      'Additional directory cannot be empty',
      ErrorCodes.REQUEST_INVALID,
    );
    const result = await this.rpc.addAdditionalDir({
      id: this.id,
      path: normalized,
      persist: options?.persist ?? true,
    });
    this._summary = { ...this.requireSummary(), additionalDirs: result.additionalDirs };
    return result;
  }

  async startBtw(): Promise<string> {
    this.ensureOpen();
    return this.rpc.startBtw({ sessionId: this.id });
  }

  async cancel(options?: { source?: TurnCancelSource }): Promise<void> {
    this.ensureOpen();
    await this.rpc.cancel({ sessionId: this.id, source: options?.source });
  }

  async setModel(model: string): Promise<void> {
    this.ensureOpen();
    const normalized = normalizeRequiredString(
      model,
      'Session model cannot be empty',
      ErrorCodes.SESSION_MODEL_EMPTY,
    );
    await this.rpc.setModel({ sessionId: this.id, model: normalized });
  }

  async setThinking(level: string): Promise<void> {
    this.ensureOpen();
    const normalized = normalizeRequiredString(
      level,
      'Session thinking level cannot be empty',
      ErrorCodes.SESSION_THINKING_EMPTY,
    );
    if (!isKnownThinkingLevel(normalized)) {
      throw new LioraError(
        ErrorCodes.REQUEST_INVALID,
        `Unknown thinking level "${normalized}". Expected one of: off, on, low, medium, high, xhigh, max.`,
      );
    }
    await this.rpc.setThinking({ sessionId: this.id, level: normalized });
  }

  async setPermission(mode: PermissionMode): Promise<void> {
    this.ensureOpen();
    if (!isPermissionMode(mode)) {
      throw new LioraError(
        ErrorCodes.SESSION_PERMISSION_MODE_INVALID,
        'Session permission mode must be yolo, manual, or auto',
      );
    }
    await this.rpc.setPermission({ sessionId: this.id, mode });
  }

  /**
   * Persist path-sandbox profile on session metadata and rebuild file-tool policy.
   * Lexical guard only — not OS isolation. Sensitive-path checks stay on.
   */
  async setSandboxProfile(profile: 'off' | 'workspace' | 'read-only'): Promise<void> {
    this.ensureOpen();
    if (profile !== 'off' && profile !== 'workspace' && profile !== 'read-only') {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        'Sandbox profile must be off, workspace, or read-only',
      );
    }
    await this.rpc.updateSessionMetadata({
      sessionId: this.id,
      metadata: { custom: { sandboxProfile: profile } },
    });
    const resume = this.getResumeState();
    if (resume?.sessionMetadata !== undefined) {
      const custom = {
        ...resume.sessionMetadata.custom,
        sandboxProfile: profile,
      };
      (resume.sessionMetadata as { custom?: Record<string, unknown> }).custom = custom;
    }
  }

  /**
   * Persist process vs lexical enforcement and rebuild the live agent wrap.
   * `process` without Docker degrades to lexical (Windows Job Object is not an FS jail).
   */
  async setSandboxEnforcement(enforcement: 'lexical' | 'process'): Promise<void> {
    this.ensureOpen();
    if (enforcement !== 'lexical' && enforcement !== 'process') {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        'Sandbox enforcement must be lexical or process',
      );
    }
    await this.rpc.updateSessionMetadata({
      sessionId: this.id,
      metadata: { custom: { sandboxEnforcement: enforcement } },
    });
    const resume = this.getResumeState();
    if (resume?.sessionMetadata !== undefined) {
      const custom = {
        ...resume.sessionMetadata.custom,
        sandboxEnforcement: enforcement,
      };
      (resume.sessionMetadata as { custom?: Record<string, unknown> }).custom = custom;
    }
  }


  async compact(options: CompactOptions = {}): Promise<void> {
    this.ensureOpen();
    const instruction = normalizeOptionalString(options.instruction);
    await this.rpc.compact({
      sessionId: this.id,
      ...(instruction !== undefined ? { instruction } : {}),
    });
  }


  async cancelCompaction(): Promise<void> {
    this.ensureOpen();
    await this.rpc.cancelCompaction({ sessionId: this.id });
  }

  async undoHistory(count: number = 1): Promise<void> {
    this.ensureOpen();
    await this.rpc.undoHistory({ sessionId: this.id, count });
  }

  async getContext(): Promise<AgentContextData> {
    this.ensureOpen();
    return this.rpc.getContext({ sessionId: this.id });
  }

  async getContextComposition(): Promise<ContextComposition> {
    this.ensureOpen();
    return this.rpc.getContextComposition({ sessionId: this.id });
  }


  async getSessionTrace(): Promise<SessionTrace> {
    this.ensureOpen();
    return this.rpc.getSessionTrace({ sessionId: this.id });
  }

  async getUsage(): Promise<SessionUsage> {
    this.ensureOpen();
    return this.rpc.getUsage({ sessionId: this.id });
  }


  async getStatus(): Promise<SessionStatus> {
    this.ensureOpen();
    return this.rpc.getStatus({ sessionId: this.id });
  }

  async resetProviderRouteStatus(): Promise<
    NonNullable<SessionStatus['providerRouteStatus']> | null
  > {
    this.ensureOpen();
    return this.rpc.resetProviderRouteStatus({ sessionId: this.id });
  }


  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    const completion = Promise.withResolvers<void>();
    this.closePromise = completion.promise;
    this.closed = true;
    void this.settleClose().then(completion.resolve, completion.reject);
    return this.closePromise;
  }

  private async settleClose(): Promise<void> {
    await this.rpc.closeSession({ sessionId: this.id });
    for (const unsubscribe of this.eventUnsubscribers) unsubscribe();
    this.eventUnsubscribers.length = 0;
    this.rpc.clearSessionHandlers(this.id);
    await this.onClose?.();
  }

  /** @internal */
  emitMetaUpdated(patch: { readonly title?: string | undefined }): void {
    this.emit({
      type: 'session.meta.updated',
      sessionId: this.id,
      agentId: MAIN_AGENT_ID,
      title: patch.title,
      patch,
    });
  }

  /** @internal Update the cached summary (e.g. after a kaos-backed resume). */
  updateSummary(summary: SessionSummary): void {
    this._summary = summary;
    this.resumeState = resumeStateFromSummary(summary);
  }

  protected emit(event: Event): void {
    this.rpc.receiveEvent(event);
  }

  protected ensureOpen(): void {
    if (this.closed) {
      throw new LioraError(ErrorCodes.SESSION_CLOSED, 'Session is closed');
    }
  }

  protected requireSummary(): SessionSummary {
    if (this._summary === undefined) {
      throw new LioraError(ErrorCodes.SESSION_STATE_INVALID, 'Session summary is unavailable');
    }
    return this._summary;
  }
}
