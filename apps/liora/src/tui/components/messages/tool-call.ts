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
import { RESULT_PREVIEW_LINES } from '#/tui/constant/rendering';
import { createMarkdownTheme } from '#/tui/theme/pi-tui-theme';
import type { ToolCallBlockData, ToolResultBlockData, TranscriptDetailLevel } from '#/tui/types';
import type { ToolOutputViewportState } from '#/tui/utils/tool-output-viewport';
import { isOneLineToolLevel } from '#/tui/utils/transcript-density';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
} from '#/tui/utils/appearance-effects';
import { isRenderCacheEnabled, renderCacheEpoch } from '#/tui/utils/render-cache';
import {
  applyToolHeaderEntrance,
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/utils/transcript-entrance';

import { ShellExecutionComponent } from './shell-execution';
import { buildCompactErrorLineComponent } from './tool-call-compact-error';
import { ToolCallCallPreview, type ToolCallCallPreviewHost } from './tool-call-call-preview';
import { buildToolCallResultContentComponents } from './tool-call-content';
import { ToolCallDetachHint } from './tool-call-detach-hint';
import { toolHeaderEntranceStartedAt } from './tool-call-entrance';
import { str } from './tool-call-format';
import { composeToolCallHeader, type ToolCallHeaderState } from './tool-call-header';
import { ToolCallOutputViewportMount } from './tool-call-output-viewport';
import { buildProgressBlockComponents } from './tool-call-progress';
import {
  buildToolCallReadSnapshot,
  type ToolCallReadSnapshot,
} from './tool-call-read-snapshot';
import { hasToolCallLiveAnimation, tickToolCallRenderClock } from './tool-call-render-tick';
import {
  appendMainLiveOutputText,
  type SubagentPhase,
  type SubagentTextKind,
  type ToolCallSubagentSnapshot,
} from './tool-call-subagent';
import {
  buildMultiSubagentBlockComponents,
  buildSingleSubagentBlockComponents,
} from './tool-call-subagent-block';
import {
  appendToolCallSubToolCall,
  appendToolCallSubToolCallDelta,
  appendToolCallSubToolLiveOutput,
  appendToolCallSubagentText,
  finishToolCallSubToolCall,
  getToolCallAgentToolDescription,
  getToolCallSubagentAgentId,
  markToolCallBackgrounded,
  onToolCallSubagentCompleted,
  onToolCallSubagentFailed,
  onToolCallSubagentSpawned,
  onToolCallSubagentStarted,
  setToolCallBackgroundTaskTerminalStatus,
  setToolCallSubagentMeta,
  updateToolCallSubagentMetrics,
  type ToolCallSubagentEventHost,
} from './tool-call-subagent-events';
import { ToolCallSubagentState } from './tool-call-subagent-state';

export type { ToolCallReadSnapshot } from './tool-call-read-snapshot';
export type { ToolCallSubagentSnapshot } from './tool-call-subagent';

export class ToolCallComponent extends Container implements ToolCallCallPreviewHost {
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
  private readonly previewRevealEligible: boolean;

  private readonly subagent = new ToolCallSubagentState();
  private readonly callPreview = new ToolCallCallPreview();
  private readonly outputViewport: ToolCallOutputViewportMount;
  private readonly detachHint: ToolCallDetachHint;

  private lastStreamingProgressTickMs = 0;
  private lastSubagentElapsedTickMs = 0;
  private finishedAtMs: number | undefined;
  private subagentBlockStartIndex = 0;

  private progressLines: string[] = [];
  private static readonly MAX_PROGRESS_LINES = 24;
  private liveOutput = '';
  private liveOutputTruncated = false;

  private onSnapshotChange: (() => void) | undefined;
  private readonly entranceStartedAtMs = appearanceAnimationNow();
  private resultSettledAtMs: number | undefined;

  constructor(
    toolCall: ToolCallBlockData,
    result: ToolResultBlockData | undefined,
    ui?: RendererRootUI,
    private readonly workspaceDir?: string,
    toolOutputViewports?: Map<string, ToolOutputViewportState>,
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

    this.outputViewport = new ToolCallOutputViewportMount({
      toolCallId: toolCall.id,
      toolOutputViewports,
      isExpanded: () => this.expanded,
      addChild: (child) => this.addChild(child),
    });
    this.detachHint = new ToolCallDetachHint({
      rebuildBody: () => this.rebuildBody(),
      requestRender: () => this.ui?.requestRender(),
      hasResult: () => this.result !== undefined,
    });

    this.addChild(new Spacer(1));
    this.headerText = new Text(this.buildHeader(), 0, 0);
    this.addChild(this.headerText);
    this.rebuildBody();
    this.detachHint.start(this.toolCall.name, this.ui !== undefined);
  }

  private readonly renderCache = new RendererChildrenRenderCache();
  private lastHeaderAnimationEpoch = -1;

  private subagentEventHost(): ToolCallSubagentEventHost {
    return {
      subagent: this.subagent,
      toolCall: this.toolCall,
      result: this.result,
      refreshSubagentPresentation: (requestRender) => this.refreshSubagentPresentation(requestRender),
      rebuildContent: () => this.rebuildContent(),
      notifySnapshotChange: () => this.notifySnapshotChange(),
      refreshHeader: () => this.headerText.setText(this.buildHeader()),
      invalidate: () => this.invalidate(),
      requestRender: () => this.ui?.requestRender(),
    };
  }

  override render(width: number): string[] {
    tickToolCallRenderClock(this.renderTickInput(), {
      rebuildCallPreviewBlock: () => this.rebuildCallPreviewBlock(),
      rebuildBody: () => this.rebuildBody(),
      rebuildSubagentBlock: () => this.rebuildSubagentBlock(),
      refreshHeader: () => this.headerText.setText(this.buildHeader()),
      notifySnapshotChange: () => this.notifySnapshotChange(),
      requestRender: () => this.ui?.requestRender(),
      setLastStreamingProgressTickMs: (ms) => {
        this.lastStreamingProgressTickMs = ms;
      },
      setLastSubagentElapsedTickMs: (ms) => {
        this.lastSubagentElapsedTickMs = ms;
      },
      setSubagentSpinnerFrame: (frame) => {
        this.subagent.spinnerFrame = frame;
      },
      getSubagentSpinnerFrame: () => this.subagent.spinnerFrame,
    });
    this.syncAnimatedHeader();
    const lines = this.renderCache.render({
      width,
      cacheEpoch: hasToolCallLiveAnimation(this.renderTickInput()) ? renderCacheEpoch() : undefined,
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

  private renderTickInput() {
    return {
      toolCall: this.toolCall,
      result: this.result,
      previewRevealEligible: this.previewRevealEligible,
      previewItemTotal: this.callPreview.previewItemTotal,
      builtPreviewItemCount: this.callPreview.builtPreviewItemCount,
      lastStreamingProgressTickMs: this.lastStreamingProgressTickMs,
      lastSubagentElapsedTickMs: this.lastSubagentElapsedTickMs,
      entranceStartedAtMs: this.entranceStartedAtMs,
      resultSettledAtMs: this.resultSettledAtMs,
      isSingleSubagentView: this.isSingleSubagentView(),
      derivedSubagentPhase: this.getDerivedSubagentPhase(),
      isStreamingEditPreview: this.isStreamingEditPreview(),
      subagentSpawnEntranceAtMs: this.subagent.spawnEntranceAtMs,
      subagentStartedAtMs: this.subagent.startedAtMs,
      subagentPhase: this.subagent.phase,
      subagentOngoingSubCallsSize: this.subagent.ongoingSubCalls.size,
    };
  }

  private syncAnimatedHeader(): void {
    const epoch = renderCacheEpoch();
    if (epoch < 0 || epoch === this.lastHeaderAnimationEpoch) return;
    this.lastHeaderAnimationEpoch = epoch;
    this.headerText.setText(this.buildHeader());
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
    return this.outputViewport.scroll(deltaRows);
  }

  resizeToolOutput(requestedHeight: number, maxHeight: number): boolean {
    return this.outputViewport.resize(requestedHeight, maxHeight);
  }

  setToolOutputHovered(hovered: boolean): void {
    this.outputViewport.setHovered(hovered);
  }

  setToolOutputDragging(dragging: boolean): void {
    this.outputViewport.setDragging(dragging);
  }

  toolOutputHitAt(
    localRow: number,
    localColumn: number,
    width: number,
  ): { readonly onRail: boolean; readonly onGrip: boolean; readonly viewportRow: number } | undefined {
    return this.outputViewport.hitAt(localRow, localColumn, width, this.children);
  }

  setResult(result: ToolResultBlockData): void {
    this.result = result;
    this.finishedAtMs ??= Date.now();
    this.resultSettledAtMs = appearanceAnimationNow();
    this.progressLines = [];
    this.liveOutput = '';
    this.detachHint.clearOnResult();
    this.subagent.finalizeElapsedIfNeeded(this.toolCall.name);
    this.headerText.setText(this.buildHeader());
    this.rebuildBody();
    this.notifySnapshotChange();
  }

  updateToolCall(toolCall: ToolCallBlockData): void {
    this.toolCall = toolCall;
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
    this.detachHint.dispose();
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
    setToolCallSubagentMeta(this.subagentEventHost(), agentId, agentName);
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
    return buildToolCallReadSnapshot({
      toolCallId: this.toolCall.id,
      args: this.toolCall.args,
      result: this.result,
      workspaceDir: this.workspaceDir,
    });
  }

  get toolCallView(): Readonly<ToolCallBlockData> {
    return this.toolCall;
  }

  onSubagentSpawned(meta: {
    agentId: string;
    agentName?: string | undefined;
    runInBackground: boolean;
    modelAlias?: string | undefined;
  }): void {
    onToolCallSubagentSpawned(this.subagentEventHost(), meta);
  }

  onSubagentStarted(meta: {
    agentId: string;
    agentName?: string | undefined;
    runInBackground: boolean;
  }): void {
    onToolCallSubagentStarted(this.subagentEventHost(), meta);
  }

  onSubagentCompleted(payload: {
    contextTokens?: number | undefined;
    usage?: import('@superliora/sdk').TokenUsage | undefined;
    resultSummary: string;
  }): void {
    onToolCallSubagentCompleted(this.subagentEventHost(), payload);
  }

  updateSubagentMetrics(payload: {
    contextTokens?: number | undefined;
    usage?: import('@superliora/sdk').TokenUsage | undefined;
  }): void {
    updateToolCallSubagentMetrics(this.subagentEventHost(), payload);
  }

  onSubagentFailed(payload: { error: string }): void {
    onToolCallSubagentFailed(this.subagentEventHost(), payload);
  }

  setBackgroundTaskTerminalStatus(
    status: 'completed' | 'failed' | 'timed_out' | 'killed' | 'lost',
    options: { errorText?: string | undefined } = {},
  ): void {
    setToolCallBackgroundTaskTerminalStatus(this.subagentEventHost(), status, options);
  }

  markBackgrounded(): void {
    markToolCallBackgrounded(this.subagentEventHost());
  }

  getSubagentAgentId(): string | undefined {
    return getToolCallSubagentAgentId(this.subagentEventHost());
  }

  getAgentToolDescription(): string | undefined {
    return getToolCallAgentToolDescription(this.subagentEventHost());
  }

  appendSubagentText(text: string, kind: SubagentTextKind = 'text'): void {
    appendToolCallSubagentText(this.subagentEventHost(), text, kind);
  }

  appendSubToolCall(call: { id: string; name: string; args: Record<string, unknown> }): void {
    appendToolCallSubToolCall(this.subagentEventHost(), call);
  }

  appendSubToolCallDelta(delta: {
    id: string;
    name?: string | undefined;
    argumentsPart: string | null;
  }): void {
    appendToolCallSubToolCallDelta(this.subagentEventHost(), delta);
  }

  appendSubToolLiveOutput(id: string, text: string): void {
    appendToolCallSubToolLiveOutput(this.subagentEventHost(), id, text);
  }

  finishSubToolCall(result: {
    tool_call_id: string;
    output: string;
    is_error?: boolean | undefined;
  }): void {
    finishToolCallSubToolCall(this.subagentEventHost(), result);
  }

  getToolCall(): ToolCallBlockData {
    return this.toolCall;
  }

  getResult(): ToolResultBlockData | undefined {
    return this.result;
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  getCurrentPlan(): string | undefined {
    return this.currentPlan;
  }

  getPlanPath(): string | undefined {
    return this.planPath;
  }

  getMarkdownTheme() {
    return this.markdownTheme;
  }

  clearRenderCache(): void {
    this.renderCache.clear();
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
    this.outputViewport.reset();
    while (this.children.length > this.callPreview.callPreviewEndIndex) {
      this.children.pop();
    }
    if (this.isOneLineCollapsed) {
      this.appendCompactErrorLine();
      return;
    }
    this.appendProgressBlock();
    this.appendDetachHintBlock();
    this.appendLiveOutputBlock();
    this.appendResultContent();
    this.buildSubagentBlock();
  }

  private rebuildBody(): void {
    this.renderCache.clear();
    this.outputViewport.reset();
    while (this.children.length > 2) {
      this.children.pop();
    }
    if (this.isOneLineCollapsed) {
      this.appendCompactErrorLine();
      this.callPreview.callPreviewEndIndex = this.children.length;
      return;
    }
    this.buildCallPreview();
    this.callPreview.callPreviewEndIndex = this.children.length;
    this.appendProgressBlock();
    this.appendDetachHintBlock();
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

  private appendDetachHintBlock(): void {
    const child = this.detachHint.buildChild();
    if (child !== undefined) this.addChild(child);
  }

  private appendLiveOutputBlock(): void {
    if (this.result !== undefined) return;
    if (this.liveOutput.length === 0) return;
    this.outputViewport.mount([
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
    this.callPreview.build(this);
  }

  private rebuildCallPreviewBlock(): void {
    this.callPreview.rebuildBlock(this, this.children);
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
    this.outputViewport.mount(components);
  }
}
