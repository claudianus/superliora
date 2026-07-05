import type { AgentContextData, ContextMessage, PromptOrigin } from '../agent/context';
import type { AgentRecord } from '../agent/records';
import type { LoopRecordedEvent } from '../loop';
import type {
  JsonObject,
  JsonValue,
  SessionTrace,
  SessionTraceEvent,
  VerificationArtifact,
} from '../rpc/core-api';

const INTERNAL_ORIGINS = new Set<PromptOrigin['kind']>([
  'injection',
  'system_trigger',
  'compaction_summary',
  'hook_result',
  'cron_job',
  'cron_missed',
]);

const SECRET_KEY_RE = /(api[_-]?key|authorization|bearer|credential|password|secret|token)/i;
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
];
const MAX_STRING_LENGTH = 4000;
const MAX_DEPTH = 7;

interface BuildSessionTraceInput {
  readonly sessionId: string;
  readonly agentId: string;
  readonly context: AgentContextData;
  readonly records: readonly AgentRecord[];
  readonly generatedAt?: Date;
}

interface RedactionState {
  count: number;
}

export function buildSessionTrace(input: BuildSessionTraceInput): SessionTrace {
  const redactions: RedactionState = { count: 0 };
  const events: SessionTraceEvent[] = [];
  const verificationArtifacts: VerificationArtifact[] = [];
  const payloadRecords = input.records.filter((record) => record.type !== 'metadata');
  const source = payloadRecords.length > 0 ? 'records' : 'context_fallback';

  if (source === 'records') {
    for (const record of payloadRecords) {
      const event = traceEventFromRecord(events.length, record, redactions);
      if (event !== undefined) {
        events.push(event);
      }
      const artifact = verificationArtifactFromRecord(record, redactions);
      if (artifact !== undefined) {
        verificationArtifacts.push(artifact);
      }
    }
  } else {
    for (const message of input.context.history) {
      events.push(traceEventFromContextMessage(events.length, message, redactions));
    }
  }

  const toolCallCount =
    source === 'records'
      ? payloadRecords.filter(
          (record) =>
            record.type === 'context.append_loop_event' &&
            record.event.type === 'tool.call',
        ).length
      : input.context.history.reduce((sum, message) => sum + message.toolCalls.length, 0);
  const toolResultCount =
    source === 'records'
      ? payloadRecords.filter(
          (record) =>
            record.type === 'context.append_loop_event' &&
            record.event.type === 'tool.result',
        ).length
      : input.context.history.filter((message) => message.role === 'tool').length;

  return {
    sessionId: input.sessionId,
    agentId: input.agentId,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    context: input.context,
    completeness: {
      source,
      recordCount: input.records.length,
      traceEventCount: events.length,
      messageCount: input.context.history.length,
      filteredInternalMessageCount: input.context.history.filter(isInternalMessage).length,
      toolCallCount,
      toolResultCount,
      subagentLifecycleCount: events.filter((event) => event.type.startsWith('subagent.')).length,
      ultraworkEventCount: events.filter((event) => event.type.startsWith('ultrawork.')).length,
      redactedCount: redactions.count,
      warnings:
        source === 'context_fallback'
          ? ['Agent records were unavailable; trace was projected from visible context only.']
          : [],
    },
    events,
    verificationArtifacts,
  };
}

function traceEventFromRecord(
  index: number,
  record: AgentRecord,
  redactions: RedactionState,
): SessionTraceEvent | undefined {
  const id = `${String(index + 1).padStart(5, '0')}:${record.type}`;
  switch (record.type) {
    case 'turn.prompt':
      return event(id, index, record, 'turn.prompt', 'User prompt submitted', originSummary(record.origin), {
        origin: record.origin,
        input: record.input,
      }, redactions);
    case 'turn.steer':
      return event(id, index, record, 'turn.steer', 'Assistant continuation steered', originSummary(record.origin), {
        origin: record.origin,
        input: record.input,
      }, redactions);
    case 'turn.cancel':
      return event(id, index, record, 'turn.cancel', 'Turn cancelled', undefined, record, redactions);
    case 'context.append_message':
      return event(
        id,
        index,
        record,
        `message.${record.message.role}`,
        `${record.message.role} message appended`,
        messageSummary(record.message),
        { message: summarizeMessage(record.message) },
        redactions,
      );
    case 'context.append_loop_event':
      return traceEventFromLoopEvent(id, index, record.time, record.event, redactions);
    case 'context.clear':
    case 'context.apply_compaction':
    case 'context.undo':
      return event(id, index, record, record.type, contextTitle(record.type), undefined, record, redactions);
    case 'plan_mode.enter':
    case 'plan_mode.exit':
    case 'plan_mode.cancel':
      return event(id, index, record, record.type, planTitle(record.type), undefined, record, redactions);
    case 'swarm_mode.enter':
    case 'swarm_mode.exit':
      return event(id, index, record, record.type, swarmTitle(record.type), undefined, record, redactions);
    case 'goal.create':
    case 'goal.update':
    case 'goal.clear':
      return event(id, index, record, record.type, goalTitle(record.type), goalSummary(record), record, redactions);
    case 'permission.set_mode':
    case 'permission.record_approval_result':
      return event(id, index, record, record.type, permissionTitle(record.type), undefined, record, redactions);
    case 'usage.record':
      return event(id, index, record, record.type, 'Usage recorded', record.model, record, redactions);
    case 'subagent.lifecycle':
      return event(
        id,
        index,
        record,
        record.event.type,
        subagentTitle(record.event.type),
        eventSummary(record.event),
        record.event,
        redactions,
      );
    case 'ultrawork.event':
      return ultraworkTraceEvent(id, index, record, redactions);
    case 'tools.register_user_tool':
    case 'tools.unregister_user_tool':
    case 'tools.set_active_tools':
    case 'tools.update_store':
    case 'config.update':
    case 'full_compaction.begin':
    case 'full_compaction.cancel':
    case 'full_compaction.complete':
    case 'micro_compaction.apply':
    case 'forked':
      return event(id, index, record, record.type, record.type, undefined, record, redactions);
    case 'metadata':
      return undefined;
  }
}

function traceEventFromLoopEvent(
  id: string,
  index: number,
  time: number | undefined,
  loopEvent: LoopRecordedEvent,
  redactions: RedactionState,
): SessionTraceEvent {
  switch (loopEvent.type) {
    case 'tool.call':
      return eventWithData(id, index, time, 'tool.call', `Tool call: ${loopEvent.name}`, loopEvent.description, loopEvent, redactions);
    case 'tool.result':
      return eventWithData(id, index, time, 'tool.result', `Tool result: ${loopEvent.toolCallId}`, undefined, loopEvent, redactions);
    case 'step.begin':
      return eventWithData(id, index, time, 'loop.step.begin', `Step ${String(loopEvent.step)} began`, undefined, loopEvent, redactions);
    case 'step.end':
      return eventWithData(id, index, time, 'loop.step.end', `Step ${String(loopEvent.step)} ended`, loopEvent.finishReason, loopEvent, redactions);
    case 'content.part':
      return eventWithData(id, index, time, 'content.part', 'Assistant content part', contentPartSummary(loopEvent.part), loopEvent, redactions);
  }
}

function traceEventFromContextMessage(
  index: number,
  message: ContextMessage,
  redactions: RedactionState,
): SessionTraceEvent {
  return eventWithData(
    `${String(index + 1).padStart(5, '0')}:message.${message.role}`,
    index,
    undefined,
    `message.${message.role}`,
    `${message.role} message appended`,
    messageSummary(message),
    { message: summarizeMessage(message) },
    redactions,
  );
}

function ultraworkTraceEvent(
  id: string,
  index: number,
  record: Extract<AgentRecord, { type: 'ultrawork.event' }>,
  redactions: RedactionState,
): SessionTraceEvent {
  const data = asJsonObject(record.event, redactions);
  const runId = stringFrom(data['runId']);
  const stage = stringFrom(data['to']) ?? stringFrom(data['stage']);
  return {
    id,
    index,
    time: record.time,
    type: record.event.type as `ultrawork.${string}`,
    title: ultraworkTitle(record.event.type),
    summary: eventSummary(record.event),
    data,
    runId,
    stage,
    evidenceIds: evidenceIdsFrom(data),
  };
}

function verificationArtifactFromRecord(
  record: AgentRecord,
  redactions: RedactionState,
): VerificationArtifact | undefined {
  if (record.type !== 'ultrawork.event') return undefined;
  if (record.event.type !== 'ultrawork.verification.completed') return undefined;
  const data = asJsonObject(record.event, redactions);
  const verification = data['verification'];
  if (verification === null || typeof verification !== 'object' || Array.isArray(verification)) {
    return undefined;
  }
  const result = verification as JsonObject;
  const id = stringFrom(result['id']) ?? `${stringFrom(data['runId']) ?? 'ultrawork'}:verification`;
  const status = stringFrom(result['status']);
  return {
    id,
    kind: 'ultrawork.verification',
    title: 'Ultrawork verification',
    status: status === 'passed' ? 'pass' : status === 'failed' ? 'fail' : status === 'blocked' ? 'blocked' : 'unknown',
    metadata: result,
  };
}

function event(
  id: string,
  index: number,
  record: { readonly time?: number; readonly type: string },
  type: string,
  title: string,
  summary: string | undefined,
  data: unknown,
  redactions: RedactionState,
): SessionTraceEvent {
  return eventWithData(id, index, record.time, type, title, summary, data, redactions);
}

function eventWithData(
  id: string,
  index: number,
  time: number | undefined,
  type: string,
  title: string,
  summary: string | undefined,
  data: unknown,
  redactions: RedactionState,
): SessionTraceEvent {
  return {
    id,
    index,
    time,
    type,
    title,
    summary,
    data: asJsonObject(data, redactions),
  };
}

function isInternalMessage(message: ContextMessage): boolean {
  const origin = message.origin;
  return origin !== undefined && INTERNAL_ORIGINS.has(origin.kind);
}

function summarizeMessage(message: ContextMessage): JsonObject {
  return {
    role: message.role,
    origin: message.origin === undefined ? null : jsonObjectUnchecked(message.origin),
    contentPreview: messageSummary(message),
    toolCallCount: message.toolCalls.length,
    toolCallIds: message.toolCalls.map((toolCall) => toolCall.id),
    toolCallId: message.toolCallId ?? null,
    isError: message.isError ?? false,
  };
}

function messageSummary(message: ContextMessage): string {
  const parts = message.content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'think') return part.think;
      return `[${part.type}]`;
    })
    .filter((part) => part.trim().length > 0);
  if (parts.length === 0 && message.toolCalls.length > 0) {
    return `${String(message.toolCalls.length)} tool call(s)`;
  }
  return truncate(parts.join(' '), 240);
}

function contentPartSummary(part: { readonly type: string; readonly text?: string; readonly think?: string }): string {
  if (part.type === 'text' && typeof part.text === 'string') return truncate(part.text, 160);
  if (part.type === 'think' && typeof part.think === 'string') return truncate(part.think, 160);
  return `[${part.type}]`;
}

function originSummary(origin: PromptOrigin): string {
  return origin.kind;
}

function eventSummary(event: { readonly [key: string]: unknown }): string | undefined {
  if (typeof event['reason'] === 'string') return event['reason'];
  if (typeof event['description'] === 'string') return truncate(event['description'], 180);
  if (typeof event['error'] === 'string') return truncate(event['error'], 180);
  if (typeof event['resultSummary'] === 'string') return truncate(event['resultSummary'], 180);
  if (typeof event['subagentName'] === 'string') return event['subagentName'];
  return undefined;
}

function contextTitle(type: string): string {
  if (type === 'context.clear') return 'Context cleared';
  if (type === 'context.apply_compaction') return 'Context compacted';
  return 'Context undo applied';
}

function planTitle(type: string): string {
  if (type === 'plan_mode.enter') return 'Plan mode entered';
  if (type === 'plan_mode.exit') return 'Plan mode exited';
  return 'Plan mode cancelled';
}

function swarmTitle(type: string): string {
  return type === 'swarm_mode.enter' ? 'Swarm mode entered' : 'Swarm mode exited';
}

function goalTitle(type: string): string {
  if (type === 'goal.create') return 'Goal created';
  if (type === 'goal.update') return 'Goal updated';
  return 'Goal cleared';
}

function goalSummary(record: AgentRecord): string | undefined {
  if (record.type === 'goal.create') return record.objective;
  if (record.type === 'goal.update') return record.reason ?? record.status;
  return undefined;
}

function permissionTitle(type: string): string {
  return type === 'permission.set_mode' ? 'Permission mode changed' : 'Approval result recorded';
}

function subagentTitle(type: string): string {
  if (type === 'subagent.spawned') return 'Subagent spawned';
  if (type === 'subagent.started') return 'Subagent started';
  if (type === 'subagent.completed') return 'Subagent completed';
  if (type === 'subagent.failed') return 'Subagent failed';
  if (type === 'subagent.suspended') return 'Subagent suspended';
  return type;
}

function ultraworkTitle(type: string): string {
  if (type === 'ultrawork.stage.changed') return 'Ultrawork stage changed';
  if (type === 'ultrawork.team.staffed') return 'Ultrawork team staffed';
  if (type === 'ultrawork.task.assigned') return 'Ultrawork task assigned';
  if (type === 'ultrawork.collaboration.message') return 'Ultrawork collaboration message';
  if (type === 'ultrawork.collaboration.mention') return 'Ultrawork collaboration mention';
  if (type === 'ultrawork.council.decision') return 'Ultrawork council decision';
  if (type === 'ultrawork.verification.completed') return 'Ultrawork verification completed';
  if (type === 'ultrawork.knowledge.promoted') return 'Ultrawork knowledge promoted';
  return type;
}

function evidenceIdsFrom(data: JsonObject): readonly string[] | undefined {
  const evidence = data['evidence'];
  if (evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const id = stringFrom((evidence as JsonObject)['id']);
    if (id !== undefined) return [id];
  }
  const ids = data['evidenceIds'];
  if (Array.isArray(ids)) {
    return ids.filter((id): id is string => typeof id === 'string');
  }
  return undefined;
}

function asJsonObject(value: unknown, redactions: RedactionState): JsonObject {
  const json = toJsonValue(value, redactions, 0);
  if (json !== null && typeof json === 'object' && !Array.isArray(json)) return json;
  return { value: json };
}

function toJsonValue(value: unknown, redactions: RedactionState, depth: number, key?: string): JsonValue {
  if (key !== undefined && SECRET_KEY_RE.test(key) && value !== undefined && value !== null) {
    redactions.count += 1;
    return '[redacted]';
  }
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string') return sanitizeString(value, redactions);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item, redactions, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      out[entryKey] = toJsonValue(entryValue, redactions, depth + 1, entryKey);
    }
    return out;
  }
  return String(value);
}

function sanitizeString(value: string, redactions: RedactionState): string {
  let out = value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
    : value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, () => {
      redactions.count += 1;
      return '[redacted]';
    });
  }
  return out;
}

function jsonObjectUnchecked(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function stringFrom(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}
