/**
 * Loop19b — compact session trace dump for Settings → Bench / Diagnostics.
 * Full durable export remains /export + debug zip; this is a glance + JSON copy block.
 */

export const SESSION_TRACE_DUMP_SCHEMA = 'superliora.session_trace.v1' as const;

/** Max events kept in the dump payload (newest last). */
export const SESSION_TRACE_DUMP_EVENT_CAP = 40;

/** Max chars for event summary/title fields in the dump. */
export const SESSION_TRACE_DUMP_TEXT_CAP = 160;

export interface SessionTraceDumpEventLike {
  readonly id?: string;
  readonly index?: number;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly time?: number;
}

export interface SessionTraceDumpCompletenessLike {
  readonly source: string;
  readonly recordCount: number;
  readonly traceEventCount: number;
  readonly messageCount: number;
  readonly filteredInternalMessageCount: number;
  readonly toolCallCount: number;
  readonly toolResultCount: number;
  readonly subagentLifecycleCount: number;
  readonly ultraworkEventCount: number;
  readonly redactedCount: number;
  readonly warnings: readonly string[];
}

export interface SessionTraceDumpInputLike {
  readonly sessionId: string;
  readonly agentId: string;
  readonly generatedAt: string;
  readonly completeness: SessionTraceDumpCompletenessLike;
  readonly events: readonly SessionTraceDumpEventLike[];
  readonly verificationArtifacts?: readonly { readonly id: string; readonly kind: string }[];
}

export interface SessionTraceDumpEvent {
  readonly id: string;
  readonly index: number;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly time?: number;
}

export interface SessionTraceDumpExport {
  readonly schema: typeof SESSION_TRACE_DUMP_SCHEMA;
  readonly capturedAt: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly generatedAt: string;
  readonly completeness: SessionTraceDumpCompletenessLike;
  readonly eventCount: number;
  readonly eventsTruncated: boolean;
  readonly events: readonly SessionTraceDumpEvent[];
  readonly verificationArtifactCount: number;
}

export interface BuildSessionTraceDumpInput {
  readonly trace: SessionTraceDumpInputLike;
  readonly capturedAtIso?: string;
  readonly eventCap?: number;
  readonly textCap?: number;
}

function clipText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function buildSessionTraceDumpPayload(
  input: BuildSessionTraceDumpInput,
): SessionTraceDumpExport {
  const cap = input.eventCap ?? SESSION_TRACE_DUMP_EVENT_CAP;
  const textCap = input.textCap ?? SESSION_TRACE_DUMP_TEXT_CAP;
  const all = input.trace.events;
  const slice = all.length > cap ? all.slice(all.length - cap) : all;
  const events: SessionTraceDumpEvent[] = slice.map((event, i) => {
    const summary =
      event.summary !== undefined && event.summary.length > 0
        ? clipText(event.summary, textCap)
        : undefined;
    return {
      id: event.id ?? `evt-${String(event.index ?? i)}`,
      index: event.index ?? i,
      type: event.type,
      title: clipText(event.title, textCap),
      ...(summary !== undefined ? { summary } : {}),
      ...(event.time !== undefined ? { time: event.time } : {}),
    };
  });

  return {
    schema: SESSION_TRACE_DUMP_SCHEMA,
    capturedAt: input.capturedAtIso ?? new Date().toISOString(),
    sessionId: input.trace.sessionId,
    agentId: input.trace.agentId,
    generatedAt: input.trace.generatedAt,
    completeness: { ...input.trace.completeness },
    eventCount: all.length,
    eventsTruncated: all.length > cap,
    events,
    verificationArtifactCount: input.trace.verificationArtifacts?.length ?? 0,
  };
}

export function formatSessionTraceDumpJson(payload: SessionTraceDumpExport): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Human-readable dump + JSON for Bench / Diagnostics status panel. */
export function buildSessionTraceDumpExportLines(
  input: BuildSessionTraceDumpInput,
): readonly string[] {
  const payload = buildSessionTraceDumpPayload(input);
  const c = payload.completeness;
  const lines: string[] = [
    '── Session trace dump ───────────────────────',
    `Schema: ${payload.schema}`,
    `Captured: ${payload.capturedAt}`,
    `Session: ${payload.sessionId}`,
    `Agent: ${payload.agentId}`,
    `Source: ${c.source} · events ${String(payload.eventCount)}` +
      (payload.eventsTruncated
        ? ` (show last ${String(payload.events.length)})`
        : ''),
    `Records: ${String(c.recordCount)} · messages ${String(c.messageCount)} · tools ${String(c.toolCallCount)}→${String(c.toolResultCount)}`,
    `Subagent lifecycle: ${String(c.subagentLifecycleCount)} · ultrawork ${String(c.ultraworkEventCount)} · redacted ${String(c.redactedCount)}`,
    `Verification artifacts: ${String(payload.verificationArtifactCount)}`,
  ];
  if (c.warnings.length > 0) {
    lines.push(`Warnings: ${c.warnings.join(' · ')}`);
  }
  if (payload.events.length > 0) {
    const preview = payload.events
      .slice(-6)
      .map((e) => e.type)
      .join(' · ');
    lines.push(`Recent types (≤6): ${preview}`);
  } else {
    lines.push('Recent types: (empty)');
  }
  lines.push('', '── JSON (copy) ─────────────────────────────');
  for (const line of formatSessionTraceDumpJson(payload).trimEnd().split('\n')) {
    lines.push(line);
  }
  return lines;
}

/** Empty-state lines when no session / trace fetch failed. */
export function buildSessionTraceDumpUnavailableLines(reason: string): readonly string[] {
  return [
    '── Session trace dump ───────────────────────',
    `Schema: ${SESSION_TRACE_DUMP_SCHEMA}`,
    `· ${reason}`,
    '· Full durable export: /export or debug zip from session commands.',
  ];
}
