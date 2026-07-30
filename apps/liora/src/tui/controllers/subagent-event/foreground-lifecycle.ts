import type { Event } from '@superliora/sdk';

import type { ToolCallBlockData } from '../../types';
import { notifySubagentAttention } from '../../utils/notification/attention-notifications';
import { argsRecord, serializeToolResultOutput } from '../../utils/event-payload';
import { formatHookResultPlain } from '../../utils/hook-result-format';
import type { SessionEventHost } from '../session-event/handler';
import type { SubagentLifecycleEventOf } from './helpers';
import type { SubagentInfo } from './handler';
import type { SubagentSwarmCoordinator } from './swarm';

export function routeChildAgentToolEvent(
  host: SessionEventHost,
  swarm: SubagentSwarmCoordinator,
  childAgentId: string,
  parentToolCallId: string,
  info: SubagentInfo,
  event: Event,
): boolean {
  if (swarm.applyChildAgentEvent(parentToolCallId, event, childAgentId)) {
    return true;
  }

  const toolCall = host.streamingUI.getToolComponent(parentToolCallId);
  if (toolCall === undefined) return true;
  toolCall.setSubagentMeta(childAgentId, info.name);

  if (event.type === 'hook.result') {
    toolCall.appendSubagentText(formatHookResultPlain(event), 'text');
  } else if (event.type === 'assistant.delta') {
    toolCall.appendSubagentText(event.delta, 'text');
  } else if (event.type === 'thinking.delta') {
    toolCall.appendSubagentText(event.delta, 'thinking');
  } else if (event.type === 'tool.call.started') {
    toolCall.appendSubToolCall({
      id: `${childAgentId}:${event.toolCallId}`,
      name: event.name,
      args: argsRecord(event.args),
    });
  } else if (event.type === 'tool.call.delta') {
    toolCall.appendSubToolCallDelta({
      id: `${childAgentId}:${event.toolCallId}`,
      name: event.name,
      argumentsPart: event.argumentsPart ?? null,
    });
  } else if (
    event.type === 'tool.progress' &&
    (event.update.kind === 'stdout' || event.update.kind === 'stderr') &&
    event.update.text !== undefined
  ) {
    toolCall.appendSubToolLiveOutput(`${childAgentId}:${event.toolCallId}`, event.update.text);
  } else if (event.type === 'tool.result') {
    toolCall.finishSubToolCall({
      tool_call_id: `${childAgentId}:${event.toolCallId}`,
      output: serializeToolResultOutput(event.output),
      is_error: event.isError,
    });
  } else if (event.type === 'agent.status.updated') {
    const usageObj = event.usage;
    const totalUsage = usageObj?.total ?? usageObj?.currentTurn;
    toolCall.updateSubagentMetrics({
      contextTokens: event.contextTokens,
      usage: totalUsage,
    });
  }
  return true;
}

export function handleForegroundSubagentSpawned(
  host: SessionEventHost,
  swarm: SubagentSwarmCoordinator,
  event: SubagentLifecycleEventOf<'subagent.spawned'>,
): void {
  if (swarm.registerSubagent(event.parentToolCallId, event)) {
    return;
  }

  let tc = getOrActivateToolComponent(host, event.parentToolCallId);
  tc ??= createStandaloneSubagentToolCall(host, event);
  if (tc === undefined) return;
  tc.onSubagentSpawned({
    agentId: event.subagentId,
    agentName: event.subagentName,
    runInBackground: event.runInBackground,
    modelAlias: event.modelAlias,
  });
}

export function handleForegroundSubagentStarted(
  host: SessionEventHost,
  swarm: SubagentSwarmCoordinator,
  event: SubagentLifecycleEventOf<'subagent.started'>,
  info: SubagentInfo,
): void {
  if (swarm.markStarted(info.parentToolCallId, event.subagentId)) {
    return;
  }

  const tc = getOrActivateToolComponent(host, info.parentToolCallId);
  if (tc === undefined) return;
  tc.onSubagentStarted({
    agentId: event.subagentId,
    agentName: info.name,
    runInBackground: info.runInBackground,
  });
}

export function handleForegroundSubagentSuspended(
  swarm: SubagentSwarmCoordinator,
  event: SubagentLifecycleEventOf<'subagent.suspended'>,
  info: SubagentInfo,
): void {
  swarm.markSuspended(info.parentToolCallId, {
    agentId: event.subagentId,
    reason: event.reason,
    swarmIndex: info.swarmIndex,
  });
}

export function handleForegroundSubagentCompleted(
  host: SessionEventHost,
  swarm: SubagentSwarmCoordinator,
  event: SubagentLifecycleEventOf<'subagent.completed'>,
  info: SubagentInfo,
): void {
  const { parentToolCallId } = info;
  if (swarm.markCompleted(parentToolCallId, event.subagentId, event.resultSummary)) {
    host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
    return;
  }

  const tc = host.streamingUI.getToolComponent(parentToolCallId);
  if (tc === undefined) return;
  tc.onSubagentCompleted({
    contextTokens: event.contextTokens,
    usage: event.usage,
    resultSummary: event.resultSummary,
  });
  notifySubagentAttention(
    host.state,
    event.subagentId,
    'completed',
    event.resultSummary,
  );
  host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
}

export function handleForegroundSubagentFailed(
  host: SessionEventHost,
  swarm: SubagentSwarmCoordinator,
  event: SubagentLifecycleEventOf<'subagent.failed'>,
  info: SubagentInfo,
): void {
  const { parentToolCallId } = info;
  if (
    swarm.markFailedOrCancelled(
      parentToolCallId,
      event.subagentId,
      event.error,
      event,
    )
  ) {
    host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
    return;
  }

  const tc = host.streamingUI.getToolComponent(parentToolCallId);
  if (tc === undefined) return;
  tc.onSubagentFailed({ error: event.error });
  notifySubagentAttention(host.state, event.subagentId, 'failed', event.error);
  host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
}

function getOrActivateToolComponent(host: SessionEventHost, parentToolCallId: string) {
  let component = host.streamingUI.getToolComponent(parentToolCallId);
  if (component !== undefined) return component;
  const toolCall = host.streamingUI.getActiveToolCall(parentToolCallId);
  if (toolCall === undefined) return undefined;
  host.streamingUI.onToolCallStart(toolCall);
  return host.streamingUI.getToolComponent(parentToolCallId);
}

function createStandaloneSubagentToolCall(
  host: SessionEventHost,
  event: SubagentLifecycleEventOf<'subagent.spawned'>,
) {
  const description = event.description ?? `Run ${event.subagentName} agent`;
  const { turnId, step } = host.streamingUI.getTurnContext();
  const toolCall: ToolCallBlockData = {
    id: event.parentToolCallId,
    name: 'Agent',
    args: {
      description,
      subagent_type: event.subagentName,
    },
    description,
    step,
    turnId,
  };
  host.streamingUI.onToolCallStart(toolCall);
  return host.streamingUI.getToolComponent(event.parentToolCallId);
}
