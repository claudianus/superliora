import type { Component } from '#/tui/renderer';

import { RESULT_PREVIEW_LINES } from '#/tui/constant/rendering';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import { ShellExecutionComponent } from '../shell/shell-execution';
import { buildCompactErrorLineComponent } from './compact-error';
import type { ToolCallCallPreview, ToolCallCallPreviewHost } from './call-preview';
import { buildToolCallResultContentComponents } from './content';
import type { ToolCallDetachHint } from './detach-hint';
import type { ToolCallOutputViewportMount } from './output-viewport';
import { buildProgressBlockComponents } from './progress';
import type { SubagentPhase } from './subagent';
import {
  buildMultiSubagentBlockComponents,
  buildSingleSubagentBlockComponents,
} from './subagent-block';
import type { ToolCallSubagentState } from './subagent-state';

export interface ToolCallBodyRebuildHost {
  readonly toolCall: ToolCallBlockData;
  readonly result: ToolResultBlockData | undefined;
  readonly workspaceDir: string | undefined;
  readonly expanded: boolean;
  readonly isOneLineCollapsed: boolean;
  readonly progressLines: readonly string[];
  readonly liveOutput: string;
  readonly subagent: ToolCallSubagentState;
  readonly callPreview: ToolCallCallPreview;
  readonly outputViewport: ToolCallOutputViewportMount;
  readonly detachHint: ToolCallDetachHint;
  readonly children: Component[];
  /** Live stdout shell, retained for in-place stream patches. */
  liveOutputShell: ShellExecutionComponent | undefined;
  get subagentBlockStartIndex(): number;
  set subagentBlockStartIndex(value: number);
  renderCache: { clear(): void };
  addChild(child: Component): void;
  isSingleSubagentView(): boolean;
  getDerivedSubagentPhase(): SubagentPhase | undefined;
  /** Call-preview accessors (ExitPlanMode plan body, markdown theme, …). */
  readonly callPreviewHost: ToolCallCallPreviewHost;
}

export function rebuildToolCallContent(host: ToolCallBodyRebuildHost): void {
  host.renderCache.clear();
  host.outputViewport.reset();
  host.liveOutputShell = undefined;
  while (host.children.length > host.callPreview.callPreviewEndIndex) {
    host.children.pop();
  }
  if (host.isOneLineCollapsed) {
    appendCompactErrorLine(host);
    return;
  }
  appendProgressBlock(host);
  appendDetachHintBlock(host);
  appendLiveOutputBlock(host);
  appendResultContent(host);
  buildSubagentBlock(host);
}

export function rebuildToolCallBody(host: ToolCallBodyRebuildHost): void {
  host.renderCache.clear();
  host.outputViewport.reset();
  host.liveOutputShell = undefined;
  while (host.children.length > 2) {
    host.children.pop();
  }
  if (host.isOneLineCollapsed) {
    appendCompactErrorLine(host);
    host.callPreview.callPreviewEndIndex = host.children.length;
    return;
  }
  buildCallPreview(host);
  host.callPreview.callPreviewEndIndex = host.children.length;
  appendProgressBlock(host);
  appendDetachHintBlock(host);
  appendLiveOutputBlock(host);
  appendResultContent(host);
  buildSubagentBlock(host);
}

export function rebuildToolCallSubagentBlock(host: ToolCallBodyRebuildHost): void {
  host.renderCache.clear();
  while (host.children.length > host.subagentBlockStartIndex) {
    host.children.pop();
  }
  buildSubagentBlock(host);
}

function appendCompactErrorLine(host: ToolCallBodyRebuildHost): void {
  const line = buildCompactErrorLineComponent(host.result);
  if (line !== undefined) host.addChild(line);
}

function appendProgressBlock(host: ToolCallBodyRebuildHost): void {
  if (host.result !== undefined) return;
  for (const child of buildProgressBlockComponents([...host.progressLines])) {
    host.addChild(child);
  }
}

function appendDetachHintBlock(host: ToolCallBodyRebuildHost): void {
  const child = host.detachHint.buildChild();
  if (child !== undefined) host.addChild(child);
}

function appendLiveOutputBlock(host: ToolCallBodyRebuildHost): void {
  if (host.result !== undefined) return;
  if (host.liveOutput.length === 0) return;
  const shell = new ShellExecutionComponent({
    result: {
      tool_call_id: host.toolCall.id,
      output: host.liveOutput,
      is_error: false,
    },
    expanded: true,
    resultPreviewLines: RESULT_PREVIEW_LINES,
    tailOutput: false,
    expandHint: false,
  });
  host.liveOutputShell = shell;
  host.outputViewport.mount([shell], true);
}

function buildSubagentBlock(host: ToolCallBodyRebuildHost): void {
  host.subagentBlockStartIndex = host.children.length;
  if (!host.subagent.hasState()) return;

  if (host.isSingleSubagentView()) {
    buildSingleSubagentBlock(host);
    return;
  }

  for (const child of buildMultiSubagentBlockComponents({
    toolCallId: host.toolCall.id,
    workspaceDir: host.workspaceDir,
    subagentAgentName: host.subagent.agentName,
    subagentAgentId: host.subagent.agentId,
    subagentPhase: host.subagent.phase,
    subagentSpinnerFrame: host.subagent.spinnerFrame,
    subagentContextTokens: host.subagent.contextTokens,
    subagentUsage: host.subagent.usage,
    hiddenSubCallCount: host.subagent.hiddenSubCallCount,
    finishedSubCalls: host.subagent.finishedSubCalls,
    ongoingSubCalls: host.subagent.ongoingSubCalls,
    subagentText: host.subagent.text,
    subagentResultSummary: host.subagent.resultSummary,
    subagentError: host.subagent.error,
    spawnEntranceAtMs: host.subagent.spawnEntranceAtMs,
  })) {
    host.addChild(child);
  }
}

function buildSingleSubagentBlock(host: ToolCallBodyRebuildHost): void {
  for (const child of buildSingleSubagentBlockComponents({
    toolCallId: host.toolCall.id,
    workspaceDir: host.workspaceDir,
    activities: [...host.subagent.subToolActivities.values()],
    derivedSubagentPhase: host.getDerivedSubagentPhase(),
    subagentError: host.subagent.error,
    subagentText: host.subagent.text,
    subagentThinkingText: host.subagent.thinkingText,
  })) {
    host.addChild(child);
  }
}

function buildCallPreview(host: ToolCallBodyRebuildHost): void {
  host.callPreview.build(host.callPreviewHost);
}

function appendResultContent(host: ToolCallBodyRebuildHost): void {
  const { result } = host;
  if (result === undefined) return;
  const components = buildToolCallResultContentComponents({
    toolCall: host.toolCall,
    result,
    expanded: host.expanded,
    isSingleSubagentView: host.isSingleSubagentView(),
  });
  host.outputViewport.mount(components);
}
