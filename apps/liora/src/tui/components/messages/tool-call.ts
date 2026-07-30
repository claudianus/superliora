/**
 * Renders a tool call entry in the transcript.
 * Supports expand/collapse via Ctrl+O.
 */

import {
  Container,
  RendererChildrenRenderCache,
  Spacer,
  Text,
} from '#/tui/renderer';
import type { Component, RendererRootUI } from '#/tui/renderer';
import { ToolOutputViewportComponent } from '#/tui/components/messages/tool-output-viewport';
import {
  createToolOutputViewportState,
  type ToolOutputViewportState,
} from '#/tui/utils/tool-output-viewport';
import {
  BRAILLE_SPINNER_FRAMES,
  RESULT_PREVIEW_LINES,
} from '#/tui/constant/rendering';
import { currentTheme } from '#/tui/theme';
import { createMarkdownTheme } from '#/tui/theme/pi-tui-theme';
import type { ToolCallBlockData, ToolResultBlockData, TranscriptDetailLevel } from '#/tui/types';
import { isOneLineToolLevel } from '#/tui/utils/transcript-density';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  isToneSettleFlashActive,
} from '#/tui/utils/appearance-effects';
import { isRenderCacheEnabled, renderCacheEpoch } from '#/tui/utils/render-cache';
import { computeStagedLineReveal } from '#/tui/utils/streaming-text-reveal';
import {
  applyToolHeaderEntrance,
  isTranscriptEntranceActive,
  polishTranscriptLines,
  toolHeaderEntranceDurationMs,
} from '#/tui/utils/transcript-entrance';

import { ShellExecutionComponent } from './shell-execution';
import {
  buildPlanCallPreviewComponents,
  buildSettledCallPreviewComponents,
  buildStreamingCallPreviewComponents,
} from './tool-call-call-preview-body';
import { buildCompactErrorLineComponent } from './tool-call-compact-error';
import { buildToolCallResultContentComponents } from './tool-call-content';
import {
  hasPreviewRevealStarted,
  peekPreviewRevealStartedAt,
  previewRevealStartedAt,
  stagedPreviewRevealDurationMs,
  toolHeaderEntranceStartedAt,
} from './tool-call-entrance';
import { makeWorkspaceRelativePath, str } from './tool-call-format';
import { composeToolCallHeader, type ToolCallHeaderState } from './tool-call-header';
import { buildProgressBlockComponents } from './tool-call-progress';
import {
  appendMainLiveOutputText,
  SUBAGENT_ELAPSED_INTERVAL_MS,
  type SubagentPhase,
  type SubagentTextKind,
  type ToolCallSubagentSnapshot,
} from './tool-call-subagent';
import {
  buildMultiSubagentBlockComponents,
  buildSingleSubagentBlockComponents,
} from './tool-call-subagent-block';
import { ToolCallSubagentState } from './tool-call-subagent-state';
import { countNonEmptyLines } from './tool-renderers/chip';

export type { ToolCallSubagentSnapshot } from './tool-call-subagent';

const STREAMING_PROGRESS_INTERVAL_MS = 1000;

/** Delay before a long-running foreground Bash/Agent card advertises Ctrl+B. */
const DETACH_HINT_DELAY_MS = 6_000;
const DETACH_HINT_TEXT = 'Press Ctrl+B to background this task · /tasks to inspect';

/**
 * Immutable Read tool state snapshot. `ReadGroupComponent` reads one-time
 * views via `ToolCallComponent.getReadSnapshot()` and sums lines for the group
 * header. `lines` is 0 while pending or failed, and the non-empty result line
 * count when done, matching the single-card chip.
 */
export interface ToolCallReadSnapshot {
  readonly toolCallId: string;
  readonly filePath: string | undefined;
  readonly phase: 'pending' | 'done' | 'failed';
  readonly lines: number;
}

export class ToolCallComponent extends Container {
  private expanded = false;
  private detail: TranscriptDetailLevel = 'standard';
  private detailOverrideExpanded = false;
  private toolCall: ToolCallBlockData;
  private readonly markdownTheme = createMarkdownTheme();
  private result: ToolResultBlockData | undefined;
  private ui: RendererRootUI | undefined;
  private planPath: string | undefined;
  private currentPlan: string | undefined;
  private headerText: Text;
  private callPreviewEndIndex = 0;
  private readonly previewRevealEligible: boolean;
  private previewItemTotal = 0;
  private builtPreviewItemCount = 0;

  private readonly subagent = new ToolCallSubagentState();

  private lastStreamingProgressTickMs = 0;
  private lastSubagentElapsedTickMs = 0;
  private finishedAtMs: number | undefined;
  private subagentBlockStartIndex = 0;

  private progressLines: string[] = [];
  private static readonly MAX_PROGRESS_LINES = 24;
  private liveOutput = '';
  private liveOutputTruncated = false;
  private toolOutputViewport: ToolOutputViewportComponent | undefined;
  private toolOutputViewportState = createToolOutputViewportState();
  private toolOutputHovered = false;
  private toolOutputDragging = false;

  private detachHintTimer: ReturnType<typeof setTimeout> | undefined;
  private detachHintVisible = false;
  private onSnapshotChange: (() => void) | undefined;
  private readonly entranceStartedAtMs = appearanceAnimationNow();
  private resultSettledAtMs: number | undefined;

  constructor(
    toolCall: ToolCallBlockData,
    result: ToolResultBlockData | undefined,
    ui?: RendererRootUI,
    private readonly workspaceDir?: string,
    private readonly toolOutputViewports?: Map<string, ToolOutputViewportState>,
  ) {
    super();
    this.toolCall = toolCall;
    this.result = result;
    this.previewRevealEligible = result === undefined;
    if (result !== undefined) {
      this.finishedAtMs = Date.now();
    }
    this.ui = ui;
    this.subagent.applyReplay(toolCall.subagent);

    this.addChild(new Spacer(1));
    this.headerText = new Text(this.buildHeader(), 0, 0);
    this.addChild(this.headerText);
    this.rebuildBody();
    this.syncStreamingProgressTimer();
    this.syncSubagentElapsedTimer();
    this.startDetachHintTimer();
  }

  private readonly renderCache = new RendererChildrenRenderCache();
  private lastHeaderAnimationEpoch = -1;
  private streamingShellPreview: ShellExecutionComponent | undefined;

  private hasLiveAnimation(): boolean {
    if (this.result === undefined) return true;
    if (this.isSingleSubagentView()) {
      const phase = this.getDerivedSubagentPhase();
      if (phase === 'queued' || phase === 'spawning' || phase === 'running') return true;
    }
    if (
      this.resultSettledAtMs !== undefined &&
      isToneSettleFlashActive(this.resultSettledAtMs)
    ) {
      return true;
    }
    if (this.isPreviewRevealActive()) return true;
    return isTranscriptEntranceActive(this.entranceStartedAtMs);
  }

  override render(width: number): string[] {
    this.tickClockDrivenRefresh();
    this.syncAnimatedHeader();
    const lines = this.renderCache.render({
      width,
      cacheEpoch: this.hasLiveAnimation() ? renderCacheEpoch() : undefined,
      children: this.children,
      isCacheEnabled: isRenderCacheEnabled,
    });
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs) && this.result !== undefined) {
      return lines;
    }
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'tool',
      streaming: this.result === undefined,
      appearance: getActiveAppearancePreferences(),
    });
  }

  private syncAnimatedHeader(): void {
    const epoch = renderCacheEpoch();
    if (epoch < 0 || epoch === this.lastHeaderAnimationEpoch) return;
    this.lastHeaderAnimationEpoch = epoch;
    this.headerText.setText(this.buildHeader());
  }

  private tickClockDrivenRefresh(): void {
    const now = appearanceAnimationNow();

    if (this.isPreviewRevealActive()) {
      const startedAtMs = peekPreviewRevealStartedAt(this.toolCall.id) ?? now;
      const visible = computeStagedLineReveal({
        totalLines: this.previewItemTotal,
        elapsedMs: now - startedAtMs,
        durationMs: stagedPreviewRevealDurationMs(),
      });
      if (visible !== this.builtPreviewItemCount) {
        this.rebuildCallPreviewBlock();
        this.ui?.requestRender();
      }
    }

    const shouldTickToolProgress =
      this.isStreamingEditPreview() ||
      (this.result === undefined && this.toolCall.streamingStartedAtMs !== undefined);
    if (shouldTickToolProgress) {
      if (now - this.lastStreamingProgressTickMs >= STREAMING_PROGRESS_INTERVAL_MS) {
        this.lastStreamingProgressTickMs = now;
        if (this.isStreamingEditPreview()) {
          this.rebuildBody();
        } else {
          this.headerText.setText(this.buildHeader());
        }
        this.ui?.requestRender();
      }
    } else {
      this.lastStreamingProgressTickMs = 0;
    }

    const phase = this.getDerivedSubagentPhase();
    const spawnEntranceAtMs = this.subagent.spawnEntranceAtMs;
    const spawnEntranceLive =
      spawnEntranceAtMs !== undefined &&
      now - spawnEntranceAtMs <= toolHeaderEntranceDurationMs() * 2;
    const subagentShouldTick = this.isSingleSubagentView()
      ? this.subagent.startedAtMs !== undefined &&
        (phase === 'queued' || phase === 'spawning' || phase === 'running')
      : this.subagent.phase === 'queued' ||
        this.subagent.phase === 'spawning' ||
        this.subagent.phase === 'running' ||
        this.subagent.ongoingSubCalls.size > 0 ||
        spawnEntranceLive;
    if (subagentShouldTick) {
      if (now - this.lastSubagentElapsedTickMs >= SUBAGENT_ELAPSED_INTERVAL_MS) {
        this.lastSubagentElapsedTickMs = now;
        this.subagent.spinnerFrame =
          (this.subagent.spinnerFrame + 1) % BRAILLE_SPINNER_FRAMES.length;
        this.headerText.setText(this.buildHeader());
        this.rebuildSubagentBlock();
        this.notifySnapshotChange();
        this.ui?.requestRender();
      }
    } else {
      this.lastSubagentElapsedTickMs = 0;
    }
  }

  override invalidate(): void {
    this.renderCache.clear();
    this.headerText.setText(this.buildHeader());
    this.rebuildBody();
    super.invalidate();
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.rebuildBody();
  }

  setDetail(detail: TranscriptDetailLevel): void {
    if (this.detail === detail) return;
    const wasFull = this.detail === 'full';
    this.detail = detail;
    this.detailOverrideExpanded = false;
    if (detail === 'full') this.expanded = true;
    else if (wasFull) this.expanded = false;
    this.rebuildBody();
  }

  getDetail(): TranscriptDetailLevel {
    return this.detail;
  }

  toggleDetailOverride(): boolean {
    this.detailOverrideExpanded = !this.detailOverrideExpanded;
    this.rebuildBody();
    return this.isOneLineCollapsed;
  }

  get isOneLineCollapsed(): boolean {
    return isOneLineToolLevel(this.detail) && !this.detailOverrideExpanded && !this.expanded;
  }

  get toolCallId(): string {
    return this.toolCall.id;
  }

  scrollToolOutput(deltaRows: number): boolean {
    return this.toolOutputViewport?.scroll(deltaRows) ?? false;
  }

  resizeToolOutput(requestedHeight: number, maxHeight: number): boolean {
    return this.toolOutputViewport?.resize(requestedHeight, maxHeight) ?? false;
  }

  setToolOutputHovered(hovered: boolean): void {
    this.toolOutputHovered = hovered;
    this.toolOutputViewport?.setHovered(hovered);
  }

  setToolOutputDragging(dragging: boolean): void {
    this.toolOutputDragging = dragging;
    this.toolOutputViewport?.setDragging(dragging);
  }

  toolOutputHitAt(
    localRow: number,
    localColumn: number,
    width: number,
  ): { readonly onRail: boolean; readonly onGrip: boolean; readonly viewportRow: number } | undefined {
    const viewport = this.toolOutputViewport;
    if (viewport === undefined || localRow < 0) return undefined;

    let startRow = 0;
    for (const child of this.children) {
      const rowCount = child.render(width).length;
      if (child === viewport) {
        const viewportRow = localRow - startRow;
        if (viewportRow < 0 || viewportRow >= rowCount) return undefined;
        const onRail = viewport.overflowing && localColumn === Math.max(0, width - 1);
        return {
          onRail,
          onGrip: onRail && viewport.isGripRow(viewportRow),
          viewportRow,
        };
      }
      startRow += rowCount;
    }
    return undefined;
  }

  setResult(result: ToolResultBlockData): void {
    this.result = result;
    this.finishedAtMs ??= Date.now();
    this.resultSettledAtMs = appearanceAnimationNow();
    this.progressLines = [];
    this.liveOutput = '';
    this.detachHintVisible = false;
    this.stopDetachHintTimer();
    this.subagent.finalizeElapsedIfNeeded(this.toolCall.name);
    this.syncStreamingProgressTimer();
    this.syncSubagentElapsedTimer();
    this.headerText.setText(this.buildHeader());
    this.rebuildBody();
    this.notifySnapshotChange();
  }

  updateToolCall(toolCall: ToolCallBlockData): void {
    this.toolCall = toolCall;
    this.syncStreamingProgressTimer();
    this.headerText.setText(this.buildHeader());
    this.rebuildBody();
    this.notifySnapshotChange();
    this.ui?.requestRender();
  }

  appendProgress(text: string): void {
    if (this.result !== undefined) return;
    for (const line of text.split('\n')) {
      this.progressLines.push(line);
    }
    while (this.progressLines.length > ToolCallComponent.MAX_PROGRESS_LINES) {
      this.progressLines.shift();
    }
    this.rebuildBody();
    this.notifySnapshotChange();
    this.ui?.requestRender();
  }

  appendLiveOutput(text: string): void {
    if (this.result !== undefined || text.length === 0) return;
    const next = appendMainLiveOutputText(this.liveOutput, text, this.liveOutputTruncated);
    this.liveOutput = next.text;
    this.liveOutputTruncated = next.truncated;
    this.rebuildContent();
    this.notifySnapshotChange();
    this.ui?.requestRender();
  }

  dispose(): void {
    this.stopDetachHintTimer();
  }

  setPlanInfo(info: { plan?: string; path?: string }): void {
    if (this.toolCall.name !== 'ExitPlanMode') return;
    let changed = false;
    if (info.plan !== undefined && info.plan.length > 0 && this.currentPlan !== info.plan) {
      this.currentPlan = info.plan;
      changed = true;
    }
    if (info.path !== undefined && info.path.length > 0 && this.planPath !== info.path) {
      this.planPath = info.path;
      changed = true;
    }
    if (!changed) return;
    this.rebuildBody();
    this.ui?.requestRender();
  }

  setSubagentMeta(agentId: string, agentName?: string): void {
    if (!this.subagent.setMeta(agentId, agentName)) return;
    this.refreshSubagentPresentation();
  }

  setSnapshotListener(cb: (() => void) | undefined): void {
    this.onSnapshotChange = cb;
    if (cb !== undefined) cb();
  }

  getSubagentSnapshot(): ToolCallSubagentSnapshot {
    return this.subagent.getSnapshot({
      toolCallId: this.toolCall.id,
      toolName: this.toolCall.name,
      toolCallDescription: str(this.toolCall.args['description']) || str(this.toolCall.description),
      workspaceDir: this.workspaceDir,
      result: this.result,
    });
  }

  getReadSnapshot(): ToolCallReadSnapshot {
    const args = this.toolCall.args;
    const filePathRaw = args['file_path'] ?? args['path'];
    const filePath =
      typeof filePathRaw === 'string'
        ? makeWorkspaceRelativePath(filePathRaw, this.workspaceDir)
        : undefined;
    if (this.result === undefined) {
      return { toolCallId: this.toolCall.id, filePath, phase: 'pending', lines: 0 };
    }
    if (this.result.is_error === true) {
      return { toolCallId: this.toolCall.id, filePath, phase: 'failed', lines: 0 };
    }
    return {
      toolCallId: this.toolCall.id,
      filePath,
      phase: 'done',
      lines: countNonEmptyLines(this.result.output),
    };
  }

  get toolCallView(): Readonly<ToolCallBlockData> {
    return this.toolCall;
  }

  private notifySnapshotChange(): void {
    this.onSnapshotChange?.();
  }

  private isStreamingEditPreview(): boolean {
    return (
      this.toolCall.name === 'Edit' &&
      this.result === undefined &&
      this.toolCall.streamingArguments !== undefined
    );
  }

  private syncStreamingProgressTimer(): void {
    // Clock-driven in render().
  }

  private isDetachHintEligible(): boolean {
    return this.toolCall.name === 'Bash' || this.toolCall.name === 'Agent';
  }

  private startDetachHintTimer(): void {
    if (!this.isDetachHintEligible()) return;
    if (this.result !== undefined) return;
    if (this.ui === undefined) return;
    if (this.toolCall.name === 'Agent') {
      if (this.detachHintVisible) return;
      this.detachHintVisible = true;
      this.rebuildBody();
      this.ui?.requestRender();
      return;
    }
    if (this.detachHintTimer !== undefined) return;
    this.detachHintTimer = setTimeout(() => {
      this.detachHintTimer = undefined;
      if (this.result !== undefined) return;
      this.detachHintVisible = true;
      this.rebuildBody();
      this.ui?.requestRender();
    }, DETACH_HINT_DELAY_MS);
  }

  private stopDetachHintTimer(): void {
    if (this.detachHintTimer === undefined) return;
    clearTimeout(this.detachHintTimer);
    this.detachHintTimer = undefined;
  }

  private buildDetachHintBlock(): void {
    if (!this.detachHintVisible) return;
    if (this.result !== undefined) return;
    this.addChild(new Text(currentTheme.dim(DETACH_HINT_TEXT), 2, 0));
  }

  private syncSubagentElapsedTimer(): void {
    // Clock-driven in render().
  }

  onSubagentSpawned(meta: {
    agentId: string;
    agentName?: string | undefined;
    runInBackground: boolean;
    modelAlias?: string | undefined;
  }): void {
    this.subagent.onSpawned(meta, this.toolCall.id);
    this.syncSubagentElapsedTimer();
    this.refreshSubagentPresentation();
  }

  onSubagentStarted(meta: {
    agentId: string;
    agentName?: string | undefined;
    runInBackground: boolean;
  }): void {
    this.subagent.onStarted(meta);
    this.syncSubagentElapsedTimer();
    this.refreshSubagentPresentation();
  }

  onSubagentCompleted(payload: {
    contextTokens?: number | undefined;
    usage?: import('@superliora/sdk').TokenUsage | undefined;
    resultSummary: string;
  }): void {
    this.subagent.onCompleted(payload);
    this.syncSubagentElapsedTimer();
    this.refreshSubagentPresentation();
  }

  updateSubagentMetrics(payload: {
    contextTokens?: number | undefined;
    usage?: import('@superliora/sdk').TokenUsage | undefined;
  }): void {
    this.subagent.updateMetrics(payload);
    this.headerText.setText(this.buildHeader());
    this.invalidate();
    this.notifySnapshotChange();
    this.ui?.requestRender();
  }

  onSubagentFailed(payload: { error: string }): void {
    this.subagent.onFailed(payload);
    this.syncSubagentElapsedTimer();
    this.refreshSubagentPresentation();
  }

  setBackgroundTaskTerminalStatus(
    status: 'completed' | 'failed' | 'timed_out' | 'killed' | 'lost',
    options: { errorText?: string | undefined } = {},
  ): void {
    if (!this.subagent.setBackgroundTaskTerminalStatus(status, options)) return;
    this.syncSubagentElapsedTimer();
    this.refreshSubagentPresentation(false);
  }

  markBackgrounded(): void {
    if (!this.subagent.markBackgrounded()) return;
    this.refreshSubagentPresentation();
  }

  getSubagentAgentId(): string | undefined {
    return this.subagent.getAgentId(this.toolCall.name, this.result);
  }

  getAgentToolDescription(): string | undefined {
    if (this.toolCall.name !== 'Agent') return undefined;
    const desc = this.toolCall.args['description'];
    return typeof desc === 'string' ? desc : undefined;
  }

  appendSubagentText(text: string, kind: SubagentTextKind = 'text'): void {
    this.subagent.appendText(text, kind);
    this.refreshSubagentPresentation();
  }

  appendSubToolCall(call: { id: string; name: string; args: Record<string, unknown> }): void {
    this.subagent.appendSubToolCall(call);
    this.refreshSubagentPresentation();
  }

  appendSubToolCallDelta(delta: {
    id: string;
    name?: string | undefined;
    argumentsPart: string | null;
  }): void {
    this.subagent.appendSubToolCallDelta(delta);
    this.refreshSubagentPresentation();
  }

  appendSubToolLiveOutput(id: string, text: string): void {
    if (!this.subagent.appendSubToolLiveOutput(id, text)) return;
    this.rebuildContent();
    this.notifySnapshotChange();
    this.ui?.requestRender();
  }

  finishSubToolCall(result: {
    tool_call_id: string;
    output: string;
    is_error?: boolean | undefined;
  }): void {
    if (!this.subagent.finishSubToolCall(result)) return;
    this.refreshSubagentPresentation();
  }

  private refreshSubagentPresentation(requestRender = true): void {
    this.headerText.setText(this.buildHeader());
    this.rebuildContent();
    this.notifySnapshotChange();
    if (requestRender) this.ui?.requestRender();
  }

  private buildHeader(): string {
    const header = this.composeHeader();
    if (this.result === undefined) {
      const startedAtMs = toolHeaderEntranceStartedAt(this.toolCall.id);
      const entered = applyToolHeaderEntrance(header, startedAtMs);
      const spawnAtMs = this.subagent.spawnEntranceAtMs;
      if (spawnAtMs !== undefined && this.isSingleSubagentView()) {
        return applyToolHeaderEntrance(entered, spawnAtMs);
      }
      return entered;
    }
    return header;
  }

  private composeHeader(): string {
    return composeToolCallHeader(this.headerState());
  }

  private headerState(): ToolCallHeaderState {
    return {
      toolCall: this.toolCall,
      result: this.result,
      resultSettledAtMs: this.resultSettledAtMs,
      finishedAtMs: this.finishedAtMs,
      workspaceDir: this.workspaceDir,
      isSingleSubagentView: this.isSingleSubagentView(),
      subagentAgentName: this.subagent.agentName,
      subagentModelAlias: this.subagent.modelAlias,
      derivedSubagentPhase: this.getDerivedSubagentPhase(),
      subToolActivityCount: this.subagent.subToolActivities.size,
      subagentElapsedSeconds: this.subagent.getElapsedSeconds(),
      subagentContextTokens: this.subagent.contextTokens,
      subagentUsage: this.subagent.usage,
      subagentSpinnerFrame: this.subagent.spinnerFrame,
    };
  }

  private rebuildContent(): void {
    this.renderCache.clear();
    this.toolOutputViewport = undefined;
    while (this.children.length > this.callPreviewEndIndex) {
      this.children.pop();
    }
    if (this.isOneLineCollapsed) {
      this.appendCompactErrorLine();
      return;
    }
    this.appendProgressBlock();
    this.buildDetachHintBlock();
    this.appendLiveOutputBlock();
    this.appendResultContent();
    this.buildSubagentBlock();
  }

  private rebuildBody(): void {
    this.renderCache.clear();
    this.toolOutputViewport = undefined;
    while (this.children.length > 2) {
      this.children.pop();
    }
    if (this.isOneLineCollapsed) {
      this.appendCompactErrorLine();
      this.callPreviewEndIndex = this.children.length;
      return;
    }
    this.buildCallPreview();
    this.callPreviewEndIndex = this.children.length;
    this.appendProgressBlock();
    this.buildDetachHintBlock();
    this.appendLiveOutputBlock();
    this.appendResultContent();
    this.buildSubagentBlock();
  }

  private appendCompactErrorLine(): void {
    const line = buildCompactErrorLineComponent(this.result);
    if (line !== undefined) this.addChild(line);
  }

  private appendProgressBlock(): void {
    if (this.result !== undefined) return;
    for (const child of buildProgressBlockComponents(this.progressLines)) {
      this.addChild(child);
    }
  }

  private appendLiveOutputBlock(): void {
    if (this.result !== undefined) return;
    if (this.liveOutput.length === 0) return;
    this.addToolOutputViewport([
      new ShellExecutionComponent({
        result: {
          tool_call_id: this.toolCall.id,
          output: this.liveOutput,
          is_error: false,
        },
        expanded: true,
        resultPreviewLines: RESULT_PREVIEW_LINES,
        tailOutput: false,
        expandHint: false,
      }),
    ], true);
  }

  private addToolOutputViewport(
    components: readonly Component[],
    initialFollowEnd = false,
  ): void {
    if (components.length === 0) return;
    const child = new Container();
    for (const component of components) child.addChild(component);
    const viewport = new ToolOutputViewportComponent({
      child,
      getState: () => this.getToolOutputViewportState(),
      setState: (state) => this.setToolOutputViewportState(state),
      expanded: this.expanded,
      initialFollowEnd,
    });
    viewport.setHovered(this.toolOutputHovered);
    viewport.setDragging(this.toolOutputDragging);
    this.toolOutputViewport = viewport;
    this.addChild(viewport);
  }

  private getToolOutputViewportState(): ToolOutputViewportState {
    const stored = this.toolOutputViewports?.get(this.toolCall.id);
    if (stored !== undefined) {
      this.toolOutputViewportState = stored;
      return stored;
    }
    this.toolOutputViewports?.set(this.toolCall.id, this.toolOutputViewportState);
    return this.toolOutputViewportState;
  }

  private setToolOutputViewportState(state: ToolOutputViewportState): void {
    this.toolOutputViewportState = state;
    this.toolOutputViewports?.set(this.toolCall.id, state);
  }

  private buildSubagentBlock(): void {
    this.subagentBlockStartIndex = this.children.length;
    if (!this.subagent.hasState()) return;

    if (this.isSingleSubagentView()) {
      this.buildSingleSubagentBlock();
      return;
    }

    for (const child of buildMultiSubagentBlockComponents({
      toolCallId: this.toolCall.id,
      workspaceDir: this.workspaceDir,
      subagentAgentName: this.subagent.agentName,
      subagentAgentId: this.subagent.agentId,
      subagentPhase: this.subagent.phase,
      subagentSpinnerFrame: this.subagent.spinnerFrame,
      subagentContextTokens: this.subagent.contextTokens,
      subagentUsage: this.subagent.usage,
      hiddenSubCallCount: this.subagent.hiddenSubCallCount,
      finishedSubCalls: this.subagent.finishedSubCalls,
      ongoingSubCalls: this.subagent.ongoingSubCalls,
      subagentText: this.subagent.text,
      subagentResultSummary: this.subagent.resultSummary,
      subagentError: this.subagent.error,
      spawnEntranceAtMs: this.subagent.spawnEntranceAtMs,
    })) {
      this.addChild(child);
    }
  }

  private rebuildSubagentBlock(): void {
    this.renderCache.clear();
    while (this.children.length > this.subagentBlockStartIndex) {
      this.children.pop();
    }
    this.buildSubagentBlock();
  }

  private isSingleSubagentView(): boolean {
    return this.toolCall.name === 'Agent' && this.subagent.hasState();
  }

  private getDerivedSubagentPhase(): SubagentPhase | undefined {
    return this.subagent.getDerivedPhase(this.result);
  }

  private buildSingleSubagentBlock(): void {
    for (const child of buildSingleSubagentBlockComponents({
      toolCallId: this.toolCall.id,
      workspaceDir: this.workspaceDir,
      activities: [...this.subagent.subToolActivities.values()],
      derivedSubagentPhase: this.getDerivedSubagentPhase(),
      subagentError: this.subagent.error,
      subagentText: this.subagent.text,
      subagentThinkingText: this.subagent.thinkingText,
    })) {
      this.addChild(child);
    }
  }

  private buildCallPreview(): void {
    this.previewItemTotal = 0;
    this.builtPreviewItemCount = 0;
    if (this.toolCall.name === 'ExitPlanMode') {
      for (const child of buildPlanCallPreviewComponents({
        toolCall: this.toolCall,
        result: this.result,
        currentPlan: this.currentPlan,
        planPath: this.planPath,
        markdownTheme: this.markdownTheme,
      })) {
        this.addChild(child);
      }
      return;
    }
    if (this.result === undefined && this.toolCall.truncated === true) {
      this.addCallPreviewItems(
        buildSettledCallPreviewComponents({
          toolCall: this.toolCall,
          result: this.result,
          expanded: this.expanded,
        }),
      );
      return;
    }
    if (this.result === undefined && this.toolCall.streamingArguments !== undefined) {
      this.buildStreamingPreview(this.toolCall.streamingArguments);
      return;
    }
    this.addCallPreviewItems(
      buildSettledCallPreviewComponents({
        toolCall: this.toolCall,
        result: this.result,
        expanded: this.expanded,
      }),
    );
  }

  private addCallPreviewItems(items: readonly Text[]): void {
    if (!this.previewRevealEligible) {
      for (const item of items) this.addChild(item);
      this.builtPreviewItemCount = items.length;
      return;
    }
    const durationMs = stagedPreviewRevealDurationMs();
    if (durationMs <= 0 || items.length <= 1) {
      for (const item of items) this.addChild(item);
      this.builtPreviewItemCount = items.length;
      return;
    }
    this.previewItemTotal = items.length;
    const startedAtMs = previewRevealStartedAt(this.toolCall.id);
    const visible = computeStagedLineReveal({
      totalLines: items.length,
      elapsedMs: appearanceAnimationNow() - startedAtMs,
      durationMs,
    });
    this.builtPreviewItemCount = visible;
    for (const item of items.slice(0, visible)) this.addChild(item);
  }

  private isPreviewRevealActive(): boolean {
    if (!this.previewRevealEligible || this.previewItemTotal <= 1) return false;
    if (this.builtPreviewItemCount >= this.previewItemTotal) return false;
    const durationMs = stagedPreviewRevealDurationMs();
    if (durationMs <= 0) return false;
    return hasPreviewRevealStarted(this.toolCall.id);
  }

  private rebuildCallPreviewBlock(): void {
    this.renderCache.clear();
    const tail = this.children.splice(this.callPreviewEndIndex);
    while (this.children.length > 2) {
      this.children.pop();
    }
    this.buildCallPreview();
    this.callPreviewEndIndex = this.children.length;
    for (const child of tail) {
      this.addChild(child);
    }
  }

  private buildStreamingPreview(streamText: string): void {
    const built = buildStreamingCallPreviewComponents({
      toolCall: this.toolCall,
      streamText,
      existingShell: this.streamingShellPreview,
    });
    this.streamingShellPreview = built.shell;
    for (const item of built.components) {
      if (item instanceof ShellExecutionComponent && this.children.includes(item)) continue;
      this.addChild(item);
    }
  }

  private appendResultContent(): void {
    const { result } = this;
    if (result === undefined) return;
    const components = buildToolCallResultContentComponents({
      toolCall: this.toolCall,
      result,
      expanded: this.expanded,
      isSingleSubagentView: this.isSingleSubagentView(),
    });
    this.addToolOutputViewport(components);
  }
}
