import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';
import type { SubagentPhase, SubagentTextKind } from './subagent';
import { applyToolHeaderEntrance } from '#/tui/features/transcript/transcript-entrance';

import {
  rebuildToolCallBody,
  rebuildToolCallContent,
  rebuildToolCallSubagentBlock,
  type ToolCallBodyRebuildHost,
} from './body-rebuild';
import type { ToolCallCallPreview, ToolCallCallPreviewHost } from './call-preview';
import { toolHeaderEntranceStartedAt } from './entrance';
import { composeToolCallHeader, type ToolCallHeaderState } from './header';
import type { ToolCallSubagentState } from './subagent-state';

export interface ToolCallInternalsHost {
  toolCall: ToolCallBlockData;
  result: ToolResultBlockData | undefined;
  resultSettledAtMs: number | undefined;
  finishedAtMs: number | undefined;
  workspaceDir: string | undefined;
  expanded: boolean;
  isOneLineCollapsed: boolean;
  progressLines: string[];
  liveOutput: string;
  subagent: ToolCallSubagentState;
  callPreview: ToolCallCallPreview;
  callPreviewHost: ToolCallCallPreviewHost;
  outputViewport: ToolCallBodyRebuildHost['outputViewport'];
  detachHint: ToolCallBodyRebuildHost['detachHint'];
  children: ToolCallBodyRebuildHost['children'];
  subagentBlockStartIndex: number;
  renderCache: ToolCallBodyRebuildHost['renderCache'];
  addChild: ToolCallBodyRebuildHost['addChild'];
  headerText: { setText(text: string): void };
  onSnapshotChange: (() => void) | undefined;
  ui: { requestRender(): void } | undefined;
  isSingleSubagentView(): boolean;
  getDerivedSubagentPhase(): SubagentPhase | undefined;
}

function bodyRebuildHost(host: ToolCallInternalsHost): ToolCallBodyRebuildHost {
  return {
    toolCall: host.toolCall,
    result: host.result,
    workspaceDir: host.workspaceDir,
    expanded: host.expanded,
    isOneLineCollapsed: host.isOneLineCollapsed,
    progressLines: host.progressLines,
    liveOutput: host.liveOutput,
    subagent: host.subagent,
    callPreview: host.callPreview,
    callPreviewHost: host.callPreviewHost,
    outputViewport: host.outputViewport,
    detachHint: host.detachHint,
    children: host.children,
    get subagentBlockStartIndex() {
      return host.subagentBlockStartIndex;
    },
    set subagentBlockStartIndex(value: number) {
      host.subagentBlockStartIndex = value;
    },
    renderCache: host.renderCache,
    addChild: host.addChild,
    isSingleSubagentView: () => host.isSingleSubagentView(),
    getDerivedSubagentPhase: () => host.getDerivedSubagentPhase(),
  };
}

export function notifyToolCallSnapshotChange(host: ToolCallInternalsHost): void {
  host.onSnapshotChange?.();
}

export function isToolCallStreamingEditPreview(host: ToolCallInternalsHost): boolean {
  return (
    host.toolCall.name === 'Edit' &&
    host.result === undefined &&
    host.toolCall.streamingArguments !== undefined
  );
}

export function refreshToolCallSubagentPresentation(host: ToolCallInternalsHost, requestRender = true): void {
  host.headerText.setText(buildToolCallHeaderText(host));
  rebuildToolCallContent(bodyRebuildHost(host));
  notifyToolCallSnapshotChange(host);
  if (requestRender) host.ui?.requestRender();
}

export function buildToolCallHeaderText(host: ToolCallInternalsHost): string {
  const header = composeToolCallHeader({
    toolCall: host.toolCall,
    result: host.result,
    resultSettledAtMs: host.resultSettledAtMs,
    finishedAtMs: host.finishedAtMs,
    workspaceDir: host.workspaceDir,
    isSingleSubagentView: host.isSingleSubagentView(),
    subagentAgentName: host.subagent.agentName,
    subagentModelAlias: host.subagent.modelAlias,
    derivedSubagentPhase: host.getDerivedSubagentPhase(),
    subToolActivityCount: host.subagent.subToolActivities.size,
    subagentElapsedSeconds: host.subagent.getElapsedSeconds(),
    subagentContextTokens: host.subagent.contextTokens,
    subagentUsage: host.subagent.usage,
    subagentSpinnerFrame: host.subagent.spinnerFrame,
  });
  if (host.result === undefined) {
    const startedAtMs = toolHeaderEntranceStartedAt(host.toolCall.id);
    const entered = applyToolHeaderEntrance(header, startedAtMs);
    const spawnAtMs = host.subagent.spawnEntranceAtMs;
    if (spawnAtMs !== undefined && host.isSingleSubagentView()) {
      return applyToolHeaderEntrance(entered, spawnAtMs);
    }
    return entered;
  }
  return header;
}

export function rebuildToolCallComponentContent(host: ToolCallInternalsHost): void {
  rebuildToolCallContent(bodyRebuildHost(host));
}

export function rebuildToolCallComponentBody(host: ToolCallInternalsHost): void {
  rebuildToolCallBody(bodyRebuildHost(host));
}

export function rebuildToolCallComponentSubagentBlock(host: ToolCallInternalsHost): void {
  rebuildToolCallSubagentBlock(bodyRebuildHost(host));
}

export function rebuildToolCallCallPreviewBlock(host: ToolCallInternalsHost): void {
  const previewHost = host.callPreview as unknown as ToolCallCallPreviewHost;
  host.callPreview.rebuildBlock(previewHost, host.children);
}

