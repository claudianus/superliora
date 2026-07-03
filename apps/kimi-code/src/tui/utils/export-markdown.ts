import type {
  ContentPart,
  ContextMessage,
  PromptOrigin,
  SessionTrace,
  SessionTraceEvent,
  ToolCall,
} from '@moonshot-ai/kimi-code-sdk';

const HINT_KEYS = ['path', 'file_path', 'command', 'query', 'url', 'name', 'pattern'] as const;

const MAX_HINT_WIDTH = 60;
const SECRET_KEY_RE = /(api[_-]?key|authorization|bearer|credential|password|secret|token)/i;
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
];

export function extractToolCallHint(argsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return '';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return '';

  const args = parsed as Record<string, unknown>;

  for (const key of HINT_KEYS) {
    const val = args[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return shorten(val, MAX_HINT_WIDTH);
    }
  }

  for (const val of Object.values(args)) {
    if (typeof val === 'string' && val.length > 0 && val.length <= 80) {
      return shorten(val, MAX_HINT_WIDTH);
    }
  }

  return '';
}

function shorten(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, width)}…`;
}

export function formatContentPartMd(part: ContentPart): string {
  switch (part.type) {
    case 'text':
      return redactExportText(part.text);
    case 'think':
      if (!part.think.trim()) return '';
      return `<details><summary>Thinking</summary>\n\n${redactExportText(part.think)}\n\n</details>`;
    case 'image_url':
      return '[image]';
    case 'audio_url':
      return '[audio]';
    case 'video_url':
      return '[video]';
    default:
      return `[${(part as ContentPart).type}]`;
  }
}

export function formatToolCallMd(tc: ToolCall): string {
  const argsRaw = tc.arguments ?? '{}';
  const hint = extractToolCallHint(argsRaw);
  let title = `#### Tool Call: ${tc.name}`;
  if (hint) {
    title += ` (\`${hint}\`)`;
  }

  let argsFormatted: string;
  try {
    argsFormatted = JSON.stringify(redactJsonValue(JSON.parse(argsRaw)), null, 2);
  } catch {
    argsFormatted = redactExportText(argsRaw);
  }

  return `${title}\n<!-- call_id: ${tc.id} -->\n\`\`\`json\n${argsFormatted}\n\`\`\``;
}

function formatToolResultMd(msg: ContextMessage, toolName: string, hint: string): string {
  const callId = msg.toolCallId ?? 'unknown';
  const parts: string[] = [];
  for (const part of msg.content) {
    const text = formatContentPartMd(part);
    if (text.trim()) parts.push(text);
  }
  const resultText = parts.join('\n');

  let summary = `Tool Result: ${toolName}`;
  if (hint) summary += ` (\`${hint}\`)`;

  return (
    `<details><summary>${summary}</summary>\n\n` +
    `<!-- call_id: ${callId} -->\n` +
    `${resultText}\n\n` +
    '</details>'
  );
}

const INTERNAL_ORIGINS = new Set<PromptOrigin['kind']>([
  'injection',
  'system_trigger',
  'compaction_summary',
  'hook_result',
  // Cron fires are stored as user-role records carrying a `<cron-fire ...>`
  // XML envelope meant only for the model. Replay and the TUI projector
  // already hide them; the markdown exporter must do the same or the raw
  // protocol XML leaks into the user-facing export.
  'cron_job',
  'cron_missed',
]);

export function isInternalMessage(msg: ContextMessage): boolean {
  const origin = msg.origin;
  if (origin === undefined) return false;
  return INTERNAL_ORIGINS.has(origin.kind);
}

export function groupIntoTurns(history: readonly ContextMessage[]): ContextMessage[][] {
  const turns: ContextMessage[][] = [];
  let current: ContextMessage[] = [];

  for (const msg of history) {
    if (isInternalMessage(msg)) continue;
    if (msg.role === 'user' && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(msg);
  }

  if (current.length > 0) turns.push(current);
  return turns;
}

function formatTurnMd(messages: readonly ContextMessage[], turnNumber: number): string {
  const hasUserMessage = messages.some((msg) => msg.role === 'user' && !isInternalMessage(msg));
  const title = hasUserMessage
    ? `## Turn ${String(turnNumber)}`
    : `## Assistant Continuation ${String(turnNumber)}`;
  const lines: string[] = [title, ''];

  const toolCallInfo = new Map<string, { name: string; hint: string }>();
  let assistantHeaderWritten = false;

  for (const msg of messages) {
    if (isInternalMessage(msg)) continue;

    if (msg.role === 'user') {
      lines.push('### User', '');
      for (const part of msg.content) {
        const text = formatContentPartMd(part);
        if (text.trim()) {
          lines.push(text, '');
        }
      }
    } else if (msg.role === 'assistant') {
      if (!assistantHeaderWritten) {
        lines.push('### Assistant', '');
        assistantHeaderWritten = true;
      }

      for (const part of msg.content) {
        const text = formatContentPartMd(part);
        if (text.trim()) {
          lines.push(text, '');
        }
      }

      for (const tc of msg.toolCalls) {
        const hint = extractToolCallHint(tc.arguments ?? '{}');
        toolCallInfo.set(tc.id, { name: tc.name, hint });
        lines.push(formatToolCallMd(tc), '');
      }
    } else if (msg.role === 'tool') {
      const tcId = msg.toolCallId ?? '';
      const info = toolCallInfo.get(tcId) ?? { name: 'unknown', hint: '' };
      lines.push(formatToolResultMd(msg, info.name, info.hint), '');
    } else if (msg.role === 'system') {
      lines.push(`### ${msg.role.charAt(0).toUpperCase()}${msg.role.slice(1)}`, '');
      for (const part of msg.content) {
        const text = formatContentPartMd(part);
        if (text.trim()) {
          lines.push(text, '');
        }
      }
    }
  }

  return lines.join('\n');
}

function buildOverview(
  history: readonly ContextMessage[],
  turns: readonly ContextMessage[][],
  trace: SessionTrace | undefined,
): string {
  let topic = '';
  for (const msg of history) {
    if (msg.role === 'user' && !isInternalMessage(msg)) {
      const textParts = msg.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text);
      topic = shorten(redactExportText(textParts.join(' ')), 80);
      break;
    }
  }

  const toolCallCount = history.reduce(
    (sum, msg) => sum + msg.toolCalls.length,
    0,
  );
  const realTurnCount = turns.filter((turn) =>
    turn.some((msg) => msg.role === 'user' && !isInternalMessage(msg)),
  ).length;
  const continuationCount = turns.length - realTurnCount;
  const traceLine =
    trace === undefined
      ? '- **Trace**: context-only export fallback'
      : `- **Trace**: ${trace.completeness.source} | ${String(trace.completeness.traceEventCount)} events | ${String(trace.completeness.subagentLifecycleCount)} subagent lifecycle | ${String(trace.completeness.ultraworkEventCount)} ultrawork`;

  return [
    '## Overview',
    '',
    topic ? `- **Topic**: ${topic}` : '- **Topic**: (empty)',
    `- **Conversation**: ${String(realTurnCount)} user turns | ${String(continuationCount)} assistant continuations | ${String(toolCallCount)} tool calls`,
    traceLine,
    '',
    '---',
  ].join('\n');
}

export interface BuildExportMarkdownInput {
  readonly sessionId: string;
  readonly workDir: string;
  readonly history: readonly ContextMessage[];
  readonly tokenCount: number;
  readonly now: Date;
  readonly trace?: SessionTrace | undefined;
}

export function buildExportMarkdown(input: BuildExportMarkdownInput): string {
  const { sessionId, workDir, history, tokenCount, now, trace } = input;

  const lines: string[] = [
    '---',
    `session_id: ${sessionId}`,
    `exported_at: ${now.toISOString()}`,
    `work_dir: ${workDir}`,
    `message_count: ${String(history.length)}`,
    `token_count: ${String(tokenCount)}`,
    '---',
    '',
    '# Kimi Session Export',
    '',
  ];

  const turns = groupIntoTurns(history);
  lines.push(buildOverview(history, turns, trace));
  lines.push('');
  if (trace !== undefined) {
    lines.push(formatTraceMd(trace));
  }
  lines.push('');

  for (let i = 0; i < turns.length; i++) {
    lines.push(formatTurnMd(turns[i]!, i + 1));
  }

  return lines.join('\n');
}

function formatTraceMd(trace: SessionTrace): string {
  const lines: string[] = [
    '## Session Trace',
    '',
    '### Trace Completeness',
    '',
    `- **Source**: ${trace.completeness.source}`,
    `- **Records**: ${String(trace.completeness.recordCount)} records -> ${String(trace.completeness.traceEventCount)} trace events`,
    `- **Messages**: ${String(trace.completeness.messageCount)} total | ${String(trace.completeness.filteredInternalMessageCount)} internal filtered from conversation view`,
    `- **Tools**: ${String(trace.completeness.toolCallCount)} calls | ${String(trace.completeness.toolResultCount)} results`,
    `- **Subagents**: ${String(trace.completeness.subagentLifecycleCount)} lifecycle events`,
    `- **Ultrawork**: ${String(trace.completeness.ultraworkEventCount)} events`,
    `- **Redactions**: ${String(trace.completeness.redactedCount)}`,
  ];

  if (trace.completeness.warnings.length > 0) {
    lines.push(`- **Warnings**: ${trace.completeness.warnings.map(redactExportText).join('; ')}`);
  }

  const ultraworkEvents = trace.events.filter((event) => event.type.startsWith('ultrawork.'));
  const subagentEvents = trace.events.filter((event) => event.type.startsWith('subagent.'));
  lines.push('', '### Run Timeline', '');
  if (trace.events.length === 0) {
    lines.push('- (no trace events)');
  } else {
    for (const event of trace.events) {
      lines.push(formatTraceEventMd(event));
    }
  }

  lines.push('', '### Ultrawork Events', '');
  if (ultraworkEvents.length === 0) {
    lines.push('- (none recorded)');
  } else {
    for (const event of ultraworkEvents) {
      lines.push(formatTraceEventOneLine(event));
    }
  }

  lines.push('', '### Subagent Lifecycle', '');
  if (subagentEvents.length === 0) {
    lines.push('- (none recorded)');
  } else {
    for (const event of subagentEvents) {
      lines.push(formatTraceEventOneLine(event));
    }
  }

  lines.push('', '### Verification Artifacts', '');
  if (trace.verificationArtifacts.length === 0) {
    lines.push('- (none recorded)');
  } else {
    for (const artifact of trace.verificationArtifacts) {
      const status = artifact.status === undefined ? 'unknown' : artifact.status;
      const suffix = artifact.path === undefined ? '' : ` (${artifact.path})`;
      lines.push(`- ${artifact.id}: ${artifact.title} [${status}]${suffix}`);
    }
  }

  lines.push('', '---');
  return lines.join('\n');
}

function formatTraceEventMd(event: SessionTraceEvent): string {
  const oneLine = formatTraceEventOneLine(event);
  if (event.data === undefined) return oneLine;
  return [
    oneLine,
    '<details><summary>event data</summary>',
    '',
    '```json',
    redactExportText(JSON.stringify(event.data, null, 2)),
    '```',
    '',
    '</details>',
  ].join('\n');
}

function formatTraceEventOneLine(event: SessionTraceEvent): string {
  const time = event.time === undefined ? 'no-time' : new Date(event.time).toISOString();
  const summary = event.summary === undefined ? '' : ` — ${redactExportText(event.summary)}`;
  return `- ${time} | ${event.type} | ${event.title}${summary}`;
}

function redactJsonValue(value: unknown, key?: string): unknown {
  if (key !== undefined && SECRET_KEY_RE.test(key) && value !== undefined && value !== null) {
    return '[redacted]';
  }
  if (typeof value === 'string') return redactExportText(value);
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      out[entryKey] = redactJsonValue(entryValue, entryKey);
    }
    return out;
  }
  return value;
}

function redactExportText(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }
  return out;
}
