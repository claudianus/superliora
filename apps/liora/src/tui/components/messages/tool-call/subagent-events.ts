import type { TokenUsage } from '@superliora/sdk';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import type { SubagentTextKind } from './subagent';
import type { ToolCallSubagentState } from './subagent-state';

export interface ToolCallSubagentEventHost {
  readonly subagent: ToolCallSubagentState;
  readonly toolCall: ToolCallBlockData;
  readonly result: ToolResultBlockData | undefined;
  refreshSubagentPresentation(requestRender?: boolean): void;
  rebuildContent(): void;
  notifySnapshotChange(): void;
  refreshHeader(): void;
  invalidate(): void;
  requestRender(): void;
}

export function onToolCallSubagentSpawned(
  host: ToolCallSubagentEventHost,
  meta: {
    agentId: string;
    agentName?: string | undefined;
    runInBackground: boolean;
    modelAlias?: string | undefined;
  },
): void {
  host.subagent.onSpawned(meta, host.toolCall.id);
  host.refreshSubagentPresentation();
}

export function onToolCallSubagentStarted(
  host: ToolCallSubagentEventHost,
  meta: {
    agentId: string;
    agentName?: string | undefined;
    runInBackground: boolean;
  },
): void {
  host.subagent.onStarted(meta);
  host.refreshSubagentPresentation();
}

export function onToolCallSubagentCompleted(
  host: ToolCallSubagentEventHost,
  payload: {
    contextTokens?: number | undefined;
    usage?: TokenUsage | undefined;
    resultSummary: string;
  },
): void {
  host.subagent.onCompleted(payload);
  host.refreshSubagentPresentation();
}

export function updateToolCallSubagentMetrics(
  host: ToolCallSubagentEventHost,
  payload: {
    contextTokens?: number | undefined;
    usage?: TokenUsage | undefined;
  },
): void {
  host.subagent.updateMetrics(payload);
  host.refreshHeader();
  host.invalidate();
  host.notifySnapshotChange();
  host.requestRender();
}

export function onToolCallSubagentFailed(
  host: ToolCallSubagentEventHost,
  payload: { error: string },
): void {
  host.subagent.onFailed(payload);
  host.refreshSubagentPresentation();
}

export function setToolCallBackgroundTaskTerminalStatus(
  host: ToolCallSubagentEventHost,
  status: 'completed' | 'failed' | 'timed_out' | 'killed' | 'lost',
  options: { errorText?: string | undefined } = {},
): void {
  if (!host.subagent.setBackgroundTaskTerminalStatus(status, options)) return;
  host.refreshSubagentPresentation(false);
}

export function markToolCallBackgrounded(host: ToolCallSubagentEventHost): void {
  if (!host.subagent.markBackgrounded()) return;
  host.refreshSubagentPresentation();
}

export function appendToolCallSubagentText(
  host: ToolCallSubagentEventHost,
  text: string,
  kind: SubagentTextKind = 'text',
): void {
  host.subagent.appendText(text, kind);
  host.refreshSubagentPresentation();
}

export function appendToolCallSubToolCall(
  host: ToolCallSubagentEventHost,
  call: { id: string; name: string; args: Record<string, unknown> },
): void {
  host.subagent.appendSubToolCall(call);
  host.refreshSubagentPresentation();
}

export function appendToolCallSubToolCallDelta(
  host: ToolCallSubagentEventHost,
  delta: {
    id: string;
    name?: string | undefined;
    argumentsPart: string | null;
  },
): void {
  host.subagent.appendSubToolCallDelta(delta);
  host.refreshSubagentPresentation();
}

export function appendToolCallSubToolLiveOutput(
  host: ToolCallSubagentEventHost,
  id: string,
  text: string,
): void {
  if (!host.subagent.appendSubToolLiveOutput(id, text)) return;
  host.rebuildContent();
  host.notifySnapshotChange();
  host.requestRender();
}

export function finishToolCallSubToolCall(
  host: ToolCallSubagentEventHost,
  result: {
    tool_call_id: string;
    output: string;
    is_error?: boolean | undefined;
  },
): void {
  if (!host.subagent.finishSubToolCall(result)) return;
  host.refreshSubagentPresentation();
}

export function getToolCallSubagentAgentId(host: ToolCallSubagentEventHost): string | undefined {
  return host.subagent.getAgentId(host.toolCall.name, host.result);
}

export function getToolCallAgentToolDescription(host: ToolCallSubagentEventHost): string | undefined {
  if (host.toolCall.name !== 'Agent') return undefined;
  const desc = host.toolCall.args['description'];
  return typeof desc === 'string' ? desc : undefined;
}

export function setToolCallSubagentMeta(
  host: ToolCallSubagentEventHost,
  agentId: string,
  agentName?: string,
): void {
  if (!host.subagent.setMeta(agentId, agentName)) return;
  host.refreshSubagentPresentation();
}
