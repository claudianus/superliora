import { describe, expect, it } from 'vitest';

import {
  SESSION_TRACE_DUMP_EVENT_CAP,
  SESSION_TRACE_DUMP_SCHEMA,
  buildSessionTraceDumpExportLines,
  buildSessionTraceDumpPayload,
  buildSessionTraceDumpUnavailableLines,
  formatSessionTraceDumpJson,
} from '#/tui/utils/session/session-trace-dump';

function sampleTrace(eventCount: number) {
  return {
    sessionId: 'ses_demo',
    agentId: 'main',
    generatedAt: '2026-08-02T07:00:00.000Z',
    completeness: {
      source: 'records' as const,
      recordCount: eventCount + 1,
      traceEventCount: eventCount,
      messageCount: 3,
      filteredInternalMessageCount: 1,
      toolCallCount: 2,
      toolResultCount: 2,
      subagentLifecycleCount: 1,
      ultraworkEventCount: 0,
      redactedCount: 1,
      warnings: [] as string[],
    },
    events: Array.from({ length: eventCount }, (_, i) => ({
      id: `e${String(i)}`,
      index: i,
      type: i % 2 === 0 ? 'tool.call' : 'tool.result',
      title: `Event ${String(i)}`,
      summary: `summary-${String(i)}`,
      time: 1_000 + i,
    })),
    verificationArtifacts: [{ id: 'v1', kind: 'ultrawork.verification' }],
  };
}

describe('session-trace-dump (Loop19b)', () => {
  it('builds superliora.session_trace.v1 payload with caps', () => {
    const payload = buildSessionTraceDumpPayload({
      trace: sampleTrace(SESSION_TRACE_DUMP_EVENT_CAP + 5),
      capturedAtIso: '2026-08-02T08:00:00.000Z',
    });
    expect(payload.schema).toBe(SESSION_TRACE_DUMP_SCHEMA);
    expect(payload.sessionId).toBe('ses_demo');
    expect(payload.eventCount).toBe(SESSION_TRACE_DUMP_EVENT_CAP + 5);
    expect(payload.eventsTruncated).toBe(true);
    expect(payload.events).toHaveLength(SESSION_TRACE_DUMP_EVENT_CAP);
    expect(payload.events[0]?.id).toBe(`e${String(5)}`);
    expect(payload.verificationArtifactCount).toBe(1);
    expect(payload.capturedAt).toBe('2026-08-02T08:00:00.000Z');
  });

  it('formats JSON and human export lines', () => {
    const lines = buildSessionTraceDumpExportLines({
      trace: sampleTrace(3),
      capturedAtIso: '2026-08-02T08:00:00.000Z',
    });
    const text = lines.join('\n');
    expect(text).toContain('Session trace dump');
    expect(text).toContain(SESSION_TRACE_DUMP_SCHEMA);
    expect(text).toContain('ses_demo');
    expect(text).toContain('tool.call');
    expect(text).toContain('JSON (copy)');
    expect(text).toContain('"schema": "superliora.session_trace.v1"');
    const json = formatSessionTraceDumpJson(
      buildSessionTraceDumpPayload({
        trace: sampleTrace(1),
        capturedAtIso: '2026-08-02T08:00:00.000Z',
      }),
    );
    expect(json).toContain('"eventCount": 1');
  });

  it('unavailable lines keep schema + /export hint', () => {
    const lines = buildSessionTraceDumpUnavailableLines('No active session');
    expect(lines.join('\n')).toContain(SESSION_TRACE_DUMP_SCHEMA);
    expect(lines.join('\n')).toContain('/export');
  });
});
