/**
 * Pure helpers for War Room expert talk UX (picker + transcript + direct message).
 */

export type WarRoomExpertPhase =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'suspended';

export interface WarRoomExpertView {
  readonly expertId: string;
  readonly name: string;
  readonly emoji?: string;
  readonly agentId?: string;
  readonly phase: WarRoomExpertPhase;
  readonly latestText?: string;
  readonly focus?: string;
}

export function matchWarRoomExpert(
  experts: readonly WarRoomExpertView[],
  query: string,
): WarRoomExpertView | undefined {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return undefined;
  const exactId = experts.find((expert) => expert.expertId.toLowerCase() === needle);
  if (exactId !== undefined) return exactId;
  const exactName = experts.find((expert) => expert.name.toLowerCase() === needle);
  if (exactName !== undefined) return exactName;
  const exactAgent = experts.find((expert) => expert.agentId?.toLowerCase() === needle);
  if (exactAgent !== undefined) return exactAgent;
  const partial = experts.filter(
    (expert) =>
      expert.expertId.toLowerCase().includes(needle) ||
      expert.name.toLowerCase().includes(needle),
  );
  return partial.length === 1 ? partial[0] : undefined;
}

export function warRoomExpertLabel(expert: WarRoomExpertView): string {
  const emoji = expert.emoji !== undefined && expert.emoji.length > 0 ? `${expert.emoji} ` : '';
  return `${emoji}${expert.name}`;
}

export function warRoomExpertStatusBadge(phase: WarRoomExpertPhase): string {
  switch (phase) {
    case 'running':
      return 'working';
    case 'queued':
    case 'pending':
      return 'queued';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'suspended':
      return 'suspended';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/** Prefer steer while working; otherwise start/resume with prompt. */
export function warRoomMessageMode(phase: WarRoomExpertPhase): 'steer' | 'prompt' {
  return phase === 'running' ? 'steer' : 'prompt';
}

export function formatSessionTraceLines(
  history: readonly {
    readonly role?: string;
    readonly content?: readonly { readonly type?: string; readonly text?: string }[];
  }[],
  options: { readonly maxLines?: number } = {},
): readonly string[] {
  const maxLines = options.maxLines ?? 80;
  const lines: string[] = [];
  for (const message of history) {
    const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'other';
    if (role === 'other') continue;
    const text = extractMessageText(message.content).trim();
    if (text.length === 0) continue;
    const prefix = role === 'assistant' ? '◆' : '◇';
    for (const paragraph of text.split(/\n+/)) {
      const trimmed = paragraph.trim();
      if (trimmed.length === 0) continue;
      lines.push(`${prefix} ${trimmed}`);
    }
  }
  if (lines.length <= maxLines) return lines;
  const omitted = lines.length - maxLines;
  return [`… ${String(omitted)} earlier lines omitted`, ...lines.slice(-maxLines)];
}

function extractMessageText(
  content: readonly { readonly type?: string; readonly text?: string }[] | undefined,
): string {
  if (content === undefined) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0) {
      parts.push(part.text);
    }
  }
  return parts.join('\n');
}
