/**
 * Renders a tool call entry in the transcript.
 * Density/expand follows transcript detail (Ctrl+O cycles the 4 levels).
 */

import {
  Container,
  notifyTranscriptChildGeometryDirty,
  RendererChildrenRenderCache,
  Spacer,
  Text,
} from '#/tui/renderer';
import type { Component, RendererRootUI } from '#/tui/renderer';
import { createMarkdownTheme } from '#/tui/theme/pi-tui-theme';
import type { ToolCallBlockData, ToolResultBlockData, TranscriptDetailLevel } from '#/tui/types';
import type { ToolOutputViewportState } from '#/tui/utils/tool/tool-output-viewport';
import { isOneLineToolLevel } from '#/tui/features/transcript/transcript-density';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
} from '#/tui/features/appearance/appearance-effects';
import { isRenderCacheEnabled, renderCacheEpoch } from '#/tui/utils/render/render-cache';
import { areLiveToolTicksSuppressed } from '#/tui/utils/render/transcript-paint-mode';
import {
  applyToolHeaderEntrance,
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';

import {
  rebuildToolCallBody,
  rebuildToolCallContent,
  rebuildToolCallSubagentBlock,
  type ToolCallBodyRebuildHost,
} from './body-rebuild';
import { ToolCallCallPreview, type ToolCallCallPreviewHost } from './call-preview';
import { ToolCallDetachHint } from './detach-hint';
import { toolHeaderEntranceStartedAt } from './entrance';
import { str } from './format';
import { composeToolCallHeader, type ToolCallHeaderState } from './header';
import { ToolCallOutputViewportMount } from './output-viewport';
import {
  buildToolCallReadSnapshot,
  type ToolCallReadSnapshot,
} from './read-snapshot';
import { hasToolCallLiveAnimation, tickToolCallRenderClock } from './render-tick';
import {
  appendMainLiveOutputText,
  type SubagentPhase,
  type SubagentTextKind,
  type ToolCallSubagentSnapshot,
} from './subagent';
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
} from './subagent-events';
import { ToolCallSubagentState } from './subagent-state';
import {
  buildToolCallHeaderText,
  isToolCallStreamingEditPreview,
  rebuildToolCallCallPreviewBlock,
  rebuildToolCallComponentBody,
  rebuildToolCallComponentContent,
  rebuildToolCallComponentSubagentBlock,
  refreshToolCallSubagentPresentation,
} from './tool-call-internals';


export type { ToolCallReadSnapshot } from './read-snapshot';
export type { ToolCallSubagentSnapshot } from './subagent';

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
  readonly previewRevealEligible: boolean;

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
  /** Live stdout shell — patched in place on stream chunks when possible. */
  private liveOutputShell: import('../shell/shell-execution').ShellExecutionComponent | undefined;

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
      addChild: (child) =>{  this.addChild(child); },
    });
    this.detachHint = new ToolCallDetachHint({
      rebuildBody: () =>{  rebuildToolCallComponentBody(this.internalsHost()); },
      requestRender: () => this.ui?.requestRender(),
      hasResult: () => this.result !== undefined,
    });

    this.addChild(new Spacer(1));
    this.headerText = new Text(buildToolCallHeaderText(this.internalsHost()), 0, 0);
    this.addChild(this.headerText);
    rebuildToolCallComponentBody(this.internalsHost());
    this.detachHint.start(this.toolCall.name, this.ui !== undefined);
  }

  private readonly renderCache = new RendererChildrenRenderCache();
  private lastHeaderAnimationEpoch = -1;

  private subagentEventHost(): ToolCallSubagentEventHost {
    return {
      subagent: this.subagent,
      toolCall: this.toolCall,
      result: this.result,
      refreshSubagentPresentation: (requestRender) =>{  refreshToolCallSubagentPresentation(this.internalsHost(), requestRender); },
      rebuildContent: () =>{  rebuildToolCallComponentContent(this.internalsHost()); },
      notifySnapshotChange: () => this.internalsHost().onSnapshotChange?.(),
      refreshHeader: () =>{  this.headerText.setText(buildToolCallHeaderText(this.internalsHost())); },
      invalidate: () =>{  this.invalidate(); },
      requestRender: () => this.ui?.requestRender(),
    };
  }

  override render(width: number): string[] {
    // Pure-scroll paint suppresses live ticks: rebuildBody/requestRender here
    // would keep the main thread busy across every visible tool card and make
    // the TUI look permanently frozen under wheel storms.
    if (!areLiveToolTicksSuppressed()) {
      tickToolCallRenderClock(this.renderTickInput(), {
        rebuildCallPreviewBlock: () => {
          rebuildToolCallCallPreviewBlock(this.internalsHost());
        },
        rebuildBody: () => {
          rebuildToolCallComponentBody(this.internalsHost());
        },
        rebuildSubagentBlock: () => {
          rebuildToolCallComponentSubagentBlock(this.internalsHost());
        },
        refreshHeader: () => {
          this.headerText.setText(buildToolCallHeaderText(this.internalsHost()));
        },
        notifySnapshotChange: () => this.internalsHost().onSnapshotChange?.(),
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
    }
    const lines = this.renderCache.render({
      width,
      // During pure scroll, ignore animation epoch so we hit the width cache.
      cacheEpoch:
        !areLiveToolTicksSuppressed() && hasToolCallLiveAnimation(this.renderTickInput())
          ? renderCacheEpoch()
          : undefined,
      children: this.children,
      isCacheEnabled: isRenderCacheEnabled,
    });
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs) && this.result !== undefined) {
      return lines;
    }
    // Skip entrance polish wash on pure-scroll paint (CPU only, no interaction).
    if (areLiveToolTicksSuppressed()) return lines;
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
      isStreamingEditPreview: isToolCallStreamingEditPreview(this.internalsHost()),
      subagentSpawnEntranceAtMs: this.subagent.spawnEntranceAtMs,
      subagentStartedAtMs: this.subagent.startedAtMs,
      subagentPhase: this.subagent.phase ?? 'queued',
      subagentOngoingSubCallsSize: this.subagent.ongoingSubCalls.size,
    };
  }

  private syncAnimatedHeader(): void {
    const epoch = renderCacheEpoch();
    if (epoch < 0 || epoch === this.lastHeaderAnimationEpoch) return;
    this.lastHeaderAnimationEpoch = epoch;
    this.headerText.setText(buildToolCallHeaderText(this.internalsHost()));
  }

  override invalidate(): void {
    this.renderCache.clear();
    this.headerText.setText(buildToolCallHeaderText(this.internalsHost()));
    rebuildToolCallComponentBody(this.internalsHost());
    super.invalidate();
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    rebuildToolCallComponentBody(this.internalsHost());
  }

  setDetail(detail: TranscriptDetailLevel): void {
    if (this.detail === detail) return;
    const wasFull = this.detail === 'full';
    this.detail = detail;
    this.detailOverrideExpanded = false;
    if (detail === 'full') this.expanded = true;
    else if (wasFull) this.expanded = false;
    rebuildToolCallComponentBody(this.internalsHost());
  }

  getDetail(): TranscriptDetailLevel {
    return this.detail;
  }

  toggleDetailOverride(): boolean {
    this.detailOverrideExpanded = !this.detailOverrideExpanded;
    rebuildToolCallComponentBody(this.internalsHost());
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
    this.headerText.setText(buildToolCallHeaderText(this.internalsHost()));
    rebuildToolCallComponentBody(this.internalsHost());
    this.internalsHost().onSnapshotChange?.();
  }

  updateToolCall(toolCall: ToolCallBlockData): void {
    this.toolCall = toolCall;
    this.headerText.setText(buildToolCallHeaderText(this.internalsHost()));
    rebuildToolCallComponentBody(this.internalsHost());
    this.internalsHost().onSnapshotChange?.();
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
    rebuildToolCallComponentBody(this.internalsHost());
    this.internalsHost().onSnapshotChange?.();
    this.ui?.requestRender();
  }

  appendLiveOutput(text: string): void {
    if (this.result !== undefined || text.length === 0) return;
    const next = appendMainLiveOutputText(this.liveOutput, text, this.liveOutputTruncated);
    this.liveOutput = next.text;
    this.liveOutputTruncated = next.truncated;
    // Hot path: patch mounted shell body instead of rebuilding the tool card.
    if (
      this.liveOutputShell !== undefined &&
      this.outputViewport.active !== undefined
    ) {
      this.liveOutputShell.setResultOutput(this.liveOutput);
      this.outputViewport.active.invalidate();
      this.renderCache.clear();
      notifyTranscriptChildGeometryDirty(this);
      this.internalsHost().onSnapshotChange?.();
      this.ui?.requestRender();
      return;
    }
    rebuildToolCallComponentContent(this.internalsHost());
    this.internalsHost().onSnapshotChange?.();
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
    rebuildToolCallComponentBody(this.internalsHost());
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

  private internalsHost(): import('./tool-call-internals').ToolCallInternalsHost {
    return ((component: ToolCallComponent): import('./tool-call-internals').ToolCallInternalsHost => ({
      toolCall: component.toolCall,
      result: component.result,
      resultSettledAtMs: component.resultSettledAtMs,
      finishedAtMs: component.finishedAtMs,
      workspaceDir: component.workspaceDir,
      expanded: component.expanded,
      isOneLineCollapsed: component.isOneLineCollapsed,
      progressLines: component.progressLines,
      liveOutput: component.liveOutput,
      subagent: component.subagent,
      callPreview: component.callPreview,
      callPreviewHost: component,
      outputViewport: component.outputViewport,
      detachHint: component.detachHint,
      children: component.children,
      get subagentBlockStartIndex() { return component.subagentBlockStartIndex; },
      set subagentBlockStartIndex(value: number) { component.subagentBlockStartIndex = value; },
      renderCache: component.renderCache,
      addChild: (child) => { component.addChild(child); },
      headerText: component.headerText,
      get onSnapshotChange() { return component.onSnapshotChange; },
      ui: component.ui,
      isSingleSubagentView: () => component.isSingleSubagentView(),
      getDerivedSubagentPhase: () => component.getDerivedSubagentPhase(),
      markTranscriptGeometryDirty: () => {
        notifyTranscriptChildGeometryDirty(component);
      },
      get liveOutputShell() { return component.liveOutputShell; },
      set liveOutputShell(value) { component.liveOutputShell = value; },
    }))(this);
  }

  private isSingleSubagentView(): boolean {
    return this.toolCall.name === 'Agent' && this.subagent.hasState();
  }

  private getDerivedSubagentPhase(): SubagentPhase | undefined {
    return this.subagent.getDerivedPhase(this.result);
  }
}
