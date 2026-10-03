import type { Event } from '@superliora/protocol';
import { boundedUtf8 } from './coordinator/preview';

import {
  describeSubagentToolDetail,
  previewSubagentToolArgs,
  previewSubagentToolProgress,
  previewSubagentToolResult,
} from './subagent/subagent-progress-preview';

/**
 * Bounded independent-worker activity for task surfaces. The source session's
 * ordinary event stream and persisted conversation remain unchanged. No
 * context, prompt-metadata, opaque tool custom updates or full tool payloads
 * are copied into this secondary stream.
 */
export function projectIndependentSessionActivity(event: Event): Event | undefined {
  const scope = { sessionId: event.sessionId, agentId: event.agentId, workerAncestry: event.workerAncestry };
  const workerId = event.agentId;
  switch (event.type) {
    case 'tool.call.started':
      return {
        ...scope, type: 'subagent.tool_call', subagentId: workerId,
        toolCallId: event.toolCallId, name: event.name,
        argsPreview: previewSubagentToolArgs(event.args), detail: describeSubagentToolDetail(event.name, event.args),
      };
    case 'tool.result':
      return {
        ...scope, type: 'subagent.tool_result', subagentId: workerId,
        toolCallId: event.toolCallId, isError: event.isError, resultPreview: previewSubagentToolResult(event.output),
      };
    case 'tool.progress': {
      const preview = previewSubagentToolProgress(event.update);
      return preview === undefined ? undefined : {
        ...scope, type: 'subagent.tool_progress', subagentId: workerId,
        toolCallId: event.toolCallId, ...preview,
      };
    }
    case 'assistant.delta':
    case 'thinking.delta':
      return { ...event, delta: boundedUtf8(event.delta, 2000, true) };
    case 'shell.output': {
      const preview = previewSubagentToolProgress(event.update);
      return preview === undefined ? undefined : {
        ...event, update: { kind: preview.kind, text: preview.textPreview ?? '' },
      };
    }
    case 'subagent.spawned':
      return { ...event, subagentName: boundedUtf8(event.subagentName, 1024), description: event.description === undefined ? undefined : boundedUtf8(event.description, 1024) };
    case 'subagent.completed':
      return { ...event, resultSummary: boundedUtf8(event.resultSummary, 2000, true) };
    case 'subagent.failed':
      return { ...event, error: boundedUtf8(event.error, 2000) };
    case 'subagent.started':
    case 'subagent.progress':
    case 'subagent.tool_call':
    case 'subagent.tool_result':
    case 'subagent.tool_progress':
    case 'turn.started':
    case 'turn.ended':
    case 'turn.step.started':
    case 'turn.step.completed':
    case 'shell.started':
      return event;
    default:
      return undefined;
  }
}
