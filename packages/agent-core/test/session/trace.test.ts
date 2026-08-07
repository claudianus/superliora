import { describe, expect, it } from 'vitest';

import type { AgentRecord } from '../../src/agent';
import { buildSessionTrace } from '../../src/session/trace';

describe('buildSessionTrace', () => {
  it('projects durable lifecycle records into a session trace', () => {
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
    expect(trace.completeness.recordCount).toBe(2);
    expect(trace.completeness.subagentLifecycleCount).toBe(1);
    expect(trace.completeness.filteredInternalMessageCount).toBe(1);
    expect(trace.completeness.redactedCount).toBe(1);
    expect(trace.events.map((event) => event.type)).toEqual(['subagent.spawned']);
    expect(JSON.stringify(trace.events)).not.toContain('sk-12345678901234567890');
    expect(trace.verificationArtifacts).toEqual([]);
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

  it('redacts secrets that appear past the truncation boundary', () => {
    // Build a single string > 4000 chars whose tail contains a secret token.
    // The previous order (truncate then redact) silently leaked the secret.
    const tailSecret = 'sk-abcdef0123456789abcdef0123456789';
    const padding = 'x'.repeat(5000);
    const value = `${padding}${tailSecret}`;

    const trace = buildSessionTrace({
      sessionId: 'ses_1',
      agentId: 'main',
      context: {
        tokenCount: 1,
        history: [],
      },
      records: [
        {
          type: 'subagent.lifecycle',
          time: 1,
          event: {
            type: 'subagent.spawned',
            subagentId: 'agent_1',
            subagentName: 'leaky',
            // Field name `note` is not a secret-key so redaction depends on
            // the value patterns — this is the path the order-of-operations
            // bug used to leak secrets past the truncation boundary.
            note: value,
          },
        },
      ],
    });

    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain(tailSecret);
    expect(trace.completeness.redactedCount).toBeGreaterThanOrEqual(1);
    // The truncated tail marker surfaces the dropped size for debugging.
    expect(serialized).toMatch(/truncated \d+ chars/);
  });
});
