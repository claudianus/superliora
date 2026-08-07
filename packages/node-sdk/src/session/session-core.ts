/**
 * Core Session lifecycle, prompt/control, plan/compact, and context RPC delegation.
 */

import {
  ErrorCodes,
  LioraError,
  type AgentContextData,
  type ContextComposition,
  type ContextOSRetrievalDiagnostics,
  type HarnessRefinementEvent,
  type HarnessStatusView,
  type InlineCompleteResult,
  type RefineRunResult,
  type SuggestPromptsResult,
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
  RefineOptions,
  MemoryCreateInput,
  MemoryRecord,
  MemorySearchRequest,
  MemorySearchResult,
  PermissionMode,
  PluginCommandDef,
  PluginInfo,
  PluginSummary,
  PluginThemeDef,
  PromptInput,
  ReloadSessionOptions,
  ResumedSessionState,
  ResumedSessionSummary,
  SessionPlan,
  SessionStatus,
  SessionTrace,
  SessionSummary,
  SessionUsage,
  SkillSearchResult,
  SkillSummary,
  HookRegistrySummary,
  ToolInfo,
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

  async reloadSession(options?: ReloadSessionOptions): Promise<ResumedSessionSummary> {
    this.ensureOpen();
    const summary = await this.rpc.reloadSession({
      sessionId: this.id,
      forcePluginSessionStartReminder: options?.forcePluginSessionStartReminder,
    });
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


  async init(): Promise<void> {
    this.ensureOpen();
    await this.rpc.generateAgentsMd({ sessionId: this.id });
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

  async setPlanMode(enabled: boolean, ultra = false, initialContext?: string): Promise<void> {
    this.ensureOpen();
    if (typeof enabled !== 'boolean') {
      throw new LioraError(
        ErrorCodes.SESSION_PLAN_MODE_INVALID,
        'Session plan mode must be a boolean',
      );
    }
    await this.rpc.setPlanMode({
      sessionId: this.id,
      enabled,
      ultra: ultra ? true : undefined,
      initialContext,
    });
  }


  async setPremiumQuality(enabled: boolean): Promise<void> {
    this.ensureOpen();
    if (typeof enabled !== 'boolean') {
      throw new LioraError(
        ErrorCodes.REQUEST_INVALID,
        'Session premium quality mode must be a boolean',
      );
    }
    await this.rpc.setPremiumQuality({ sessionId: this.id, enabled });
  }

  async setAskMode(enabled: boolean): Promise<void> {
    this.ensureOpen();
    if (typeof enabled !== 'boolean') {
      throw new LioraError(ErrorCodes.REQUEST_INVALID, 'Session ask mode must be a boolean');
    }
    await this.rpc.setAskMode({ sessionId: this.id, enabled });
  }

  async getPlan(): Promise<SessionPlan> {
    this.ensureOpen();
    return this.rpc.getPlan({ sessionId: this.id });
  }

  async clearPlan(): Promise<void> {
    this.ensureOpen();
    await this.rpc.clearPlan({ sessionId: this.id });
  }

  async compact(options: CompactOptions = {}): Promise<void> {
    this.ensureOpen();
    const instruction = normalizeOptionalString(options.instruction);
    await this.rpc.compact({
      sessionId: this.id,
      ...(instruction !== undefined ? { instruction } : {}),
    });
  }

  async refine(options: RefineOptions = {}): Promise<RefineRunResult> {
    this.ensureOpen();
    const instructions = normalizeOptionalString(options.instructions);
    return this.rpc.refineHarness({
      sessionId: this.id,
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
    });
  }

  async rollbackRefinement(refinementId: string): Promise<HarnessRefinementEvent> {
    this.ensureOpen();
    return this.rpc.rollbackHarnessRefinement({
      sessionId: this.id,
      refinementId,
    });
  }

  async getHarnessStatus(): Promise<HarnessStatusView> {
    this.ensureOpen();
    return this.rpc.getHarnessStatus({ sessionId: this.id });
  }

  async cancelCompaction(): Promise<void> {
    this.ensureOpen();
    await this.rpc.cancelCompaction({ sessionId: this.id });
  }

  async undoHistory(count: number = 1): Promise<void> {
    this.ensureOpen();
    await this.rpc.undoHistory({ sessionId: this.id, count });
  }

  /**
   * Restore disk files from a sealed turn snapshot (`/rewind`).
   * Does not rewrite conversation history — pair with `undoHistory` when needed.
   */
  async rewindFiles(options: { turnId?: string | undefined } = {}): Promise<{
    readonly turnId: string;
    readonly restored: readonly string[];
    readonly deleted: readonly string[];
    readonly skippedSensitive: readonly string[];
    readonly errors: readonly { path: string; message: string }[];
  }> {
    this.ensureOpen();
    return this.rpc.rewindFiles({
      sessionId: this.id,
      ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
    });
  }

  async getContext(): Promise<AgentContextData> {
    this.ensureOpen();
    return this.rpc.getContext({ sessionId: this.id });
  }

  async getContextComposition(): Promise<ContextComposition> {
    this.ensureOpen();
    return this.rpc.getContextComposition({ sessionId: this.id });
  }

  async diagnoseContextOS(
    query = '',
    limit?: number,
  ): Promise<ContextOSRetrievalDiagnostics> {
    this.ensureOpen();
    return this.rpc.diagnoseContextOS({ sessionId: this.id, query, limit });
  }

  async getSessionTrace(): Promise<SessionTrace> {
    this.ensureOpen();
    return this.rpc.getSessionTrace({ sessionId: this.id });
  }

  async getUsage(): Promise<SessionUsage> {
    this.ensureOpen();
    return this.rpc.getUsage({ sessionId: this.id });
  }

  /**
   * Predict the next words/sentence for the text the user is currently typing.
   * Returns a short continuation to render as dimmed ghost text (Tab to accept).
   * Pass `signal` to cancel an in-flight request when the user keeps typing.
   */
  async inlineComplete(input: {
    readonly text: string;
    readonly cursorLine: number;
    readonly cursorCol: number;
    readonly signal?: AbortSignal;
  }): Promise<InlineCompleteResult> {
    this.ensureOpen();
    return this.rpc.inlineComplete({ sessionId: this.id, ...input });
  }

  /**
   * Suggest contextually relevant next tasks for an empty prompt box. Returns
   * up to a handful of short imperative prompts (Tab fills the first one).
   */
  async suggestPrompts(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<SuggestPromptsResult> {
    this.ensureOpen();
    return this.rpc.suggestPrompts({ sessionId: this.id, signal: options.signal });
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

  async recall(
    query: string,
    options: Omit<MemorySearchRequest, 'query' | 'sessionId' | 'workspaceKey'> = {},
  ): Promise<readonly MemorySearchResult[]> {
    this.ensureOpen();
    const memoryQuery = normalizeRequiredString(
      query,
      'Memory recall query cannot be empty',
      ErrorCodes.REQUEST_INVALID,
    );
    return this.rpc.memoryRecall({
      ...options,
      query: memoryQuery,
      sessionId: this.id,
      workspaceKey: this.workDir,
    });
  }

  async remember(input: MemoryCreateInput): Promise<MemoryRecord> {
    this.ensureOpen();
    const scopeKey = input.scopeKey ?? (input.scope === 'session' ? this.id : input.scope === 'workspace' ? this.workDir : undefined);
    if (scopeKey === undefined) return this.rpc.memoryRemember(input);
    return this.rpc.memoryRemember({ ...input, scopeKey });
  }

  async listSkills(): Promise<readonly SkillSummary[]> {
    this.ensureOpen();
    return this.rpc.listSkills({ sessionId: this.id });
  }

  getHookRegistry(): Promise<HookRegistrySummary> {
    this.ensureOpen();
    return this.rpc.getHookRegistry({ sessionId: this.id });
  }

  async getTools(): Promise<readonly ToolInfo[]> {
    this.ensureOpen();
    return this.rpc.getTools({ sessionId: this.id });
  }

  async listPluginCommands(): Promise<readonly PluginCommandDef[]> {
    this.ensureOpen();
    return this.rpc.listPluginCommands({ sessionId: this.id });
  }

  async listPluginThemes(): Promise<readonly PluginThemeDef[]> {
    this.ensureOpen();
    return this.rpc.listPluginThemes();
  }

  async searchSkills(
    query: string,
    options: { readonly limit?: number } = {},
  ): Promise<readonly SkillSearchResult[]> {
    this.ensureOpen();
    const skillQuery = normalizeRequiredString(
      query,
      'Skill search query cannot be empty',
      ErrorCodes.REQUEST_INVALID,
    );
    return this.rpc.searchSkills({
      sessionId: this.id,
      query: skillQuery,
      limit: options.limit,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      // Release all event subscriptions registered via onEvent().
      for (const unsubscribe of this.eventUnsubscribers) {
        unsubscribe();
      }
      this.eventUnsubscribers.length = 0;
      await this.rpc.closeSession({ sessionId: this.id });
    } finally {
      this.rpc.clearSessionHandlers(this.id);
      await this.onClose?.();
    }
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
