import { describe, expect, it } from 'vitest';

import type { AgentRecord } from '../../src/agent';
import { buildSessionTrace } from '../../src/session/trace';

describe('buildSessionTrace', () => {
  it('projects durable lifecycle and ultrawork records into a session trace', () => {
    const records: AgentRecord[] = [
      {
        type: 'metadata',
        protocol_version: '1',
        created_at: 1,
      },
      {
        type: 'subagent.lifecycle',
        time: 10,
        event: {
          type: 'subagent.spawned',
          subagentId: 'agent_1',
          subagentName: 'visual reviewer',
          token: 'sk-12345678901234567890',
        },
      },
      {
        type: 'ultrawork.event',
        time: 20,
        event: {
          type: 'ultrawork.verification.completed',
          runId: 'uw_1',
          verification: {
            id: 'verify_1',
            runId: 'uw_1',
            status: 'passed',
            checks: [{ name: 'visual probe', status: 'passed' }],
            completedAt: '2026-07-02T00:00:00.000Z',
          },
        },
      },
    ];

    const trace = buildSessionTrace({
      sessionId: 'ses_1',
      agentId: 'main',
      context: {
        tokenCount: 42,
        history: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'internal' }],
            toolCalls: [],
            origin: { kind: 'system_trigger', name: 'resume' },
          },
        ],
      },
      records,
      generatedAt: new Date('2026-07-02T00:00:01.000Z'),
    });

    expect(trace.completeness.source).toBe('records');
    expect(trace.completeness.recordCount).toBe(3);
    expect(trace.completeness.subagentLifecycleCount).toBe(1);
    expect(trace.completeness.ultraworkEventCount).toBe(1);
    expect(trace.completeness.filteredInternalMessageCount).toBe(1);
    expect(trace.completeness.redactedCount).toBe(1);
    expect(trace.events.map((event) => event.type)).toEqual([
      'subagent.spawned',
      'ultrawork.verification.completed',
    ]);
    expect(JSON.stringify(trace.events)).not.toContain('sk-12345678901234567890');
    expect(trace.verificationArtifacts).toEqual([
      {
        id: 'verify_1',
        kind: 'ultrawork.verification',
        title: 'Ultrawork verification',
        status: 'pass',
        metadata: {
          id: 'verify_1',
          runId: 'uw_1',
          status: 'passed',
          checks: [{ name: 'visual probe', status: 'passed' }],
          completedAt: '2026-07-02T00:00:00.000Z',
        },
      },
    ]);
  });

  it('falls back to context when durable records are unavailable', () => {
    const trace = buildSessionTrace({
      sessionId: 'ses_1',
      agentId: 'main',
      context: {
        tokenCount: 1,
        history: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'continued' }],
            toolCalls: [],
          },
        ],
      },
      records: [],
    });

    expect(trace.completeness.source).toBe('context_fallback');
    expect(trace.completeness.warnings[0]).toContain('records were unavailable');
    expect(trace.events[0]?.type).toBe('message.assistant');
  });
});
