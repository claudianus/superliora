import { describe, expect, it } from 'vitest';

import { buildReplay } from '../../../src/agent/replay/build';
import {
  AGENT_WIRE_PROTOCOL_VERSION,
  InMemoryAgentRecordPersistence,
  type AgentRecord,
} from '../../../src/agent/records';
import type { ContextMessage } from '../../../src/agent/context';
import { testAgent } from '../harness/agent';

describe('AgentRecords persistence metadata', () => {
  it('writes metadata before the first persisted record', async () => {
    const persistence = new InMemoryAgentRecordPersistence();
    const records = testAgent({ persistence }).agent.records;

    records.logRecord({
      type: 'turn.prompt',
      time: 123,
      input: [{ type: 'text', text: 'hello' }],
      origin: { kind: 'user' },
    });
    await records.flush();

    expect(persistence.records).toHaveLength(2);
    expect(persistence.records[0]).toMatchObject({
      type: 'metadata',
      protocol_version: AGENT_WIRE_PROTOCOL_VERSION,
      created_at: expect.any(Number),
    });
    expect(persistence.records[1]).toEqual({
      type: 'turn.prompt',
      input: [{ type: 'text', text: 'hello' }],
      origin: { kind: 'user' },
      time: 123,
    });
  });

  it('does not write metadata when replaying an empty stream', async () => {
    const persistence = new InMemoryAgentRecordPersistence();
    const records = testAgent({ persistence }).agent.records;

    await records.replay();
    expect(persistence.records).toEqual([]);
    records.logRecord({
      type: 'turn.prompt',
      input: [{ type: 'text', text: 'one' }],
      origin: { kind: 'user' },
    });
    await records.flush();

    expect(persistence.records.map((record) => record.type)).toEqual([
      'metadata',
      'turn.prompt',
    ]);
  });

  it('rejects replaying a non-empty stream without metadata', async () => {
    const persistence = new InMemoryAgentRecordPersistence([
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'one' }],
        origin: { kind: 'user' },
      },
    ]);
    const records = testAgent({ persistence }).agent.records;

    await expect(records.replay()).rejects.toThrow(
      'AgentRecords replay expected metadata as the first record',
    );
  });

  it('does not duplicate metadata after replaying existing records', async () => {
    const persistence = new InMemoryAgentRecordPersistence([
      {
        type: 'metadata',
        protocol_version: AGENT_WIRE_PROTOCOL_VERSION,
        created_at: 1,
      },
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'one' }],
        origin: { kind: 'user' },
      },
    ]);
    const records = testAgent({ persistence }).agent.records;

    await records.replay();
    records.logRecord({
      type: 'turn.prompt',
      input: [{ type: 'text', text: 'two' }],
      origin: { kind: 'user' },
    });
    await records.flush();

    expect(persistence.records.map((record) => record.type)).toEqual([
      'metadata',
      'turn.prompt',
      'turn.prompt',
    ]);
    expect(persistence.records.filter((record) => record.type === 'metadata')).toHaveLength(1);
  });

  it('does not rewrite records that already use the current wire version', async () => {
    const persistence = new RecordingInMemoryAgentRecordPersistence([
      {
        type: 'metadata',
        protocol_version: AGENT_WIRE_PROTOCOL_VERSION,
        created_at: 1,
      },
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'one' }],
        origin: { kind: 'user' },
      },
    ]);
    const records = testAgent({ persistence }).agent.records;

    await records.replay();

    expect(persistence.rewrites).toEqual([]);
  });

  it('rewrites older metadata while preserving native records and timestamps', async () => {
    const message: ContextMessage = {
      role: 'assistant',
      content: [],
      toolCalls: [{ type: 'function', id: 'call_bash', name: 'Bash', arguments: '{"command":"pwd"}' }],
    };
    const persistence = new RecordingInMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: '1.4', created_at: 1 },
      { type: 'context.append_message', time: 2, message },
    ]);
    const records = testAgent({ persistence }).agent.records;

    await records.replay();

    expect(persistence.rewrites).toHaveLength(1);
    expect(persistence.records).toEqual([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      { type: 'context.append_message', time: 2, message },
    ]);
  });

  it('warns but continues when replaying records from a newer wire version', async () => {
    const persistence = new InMemoryAgentRecordPersistence([
      {
        type: 'metadata',
        protocol_version: '9.9',
        created_at: 1,
      },
    ]);
    const records = testAgent({ persistence }).agent.records;

    const result = await records.replay();
    expect(result.warning).toContain('9.9');
    expect(result.warning).toContain(AGENT_WIRE_PROTOCOL_VERSION);
  });

  it('rejects replaying records without a registered migration path', async () => {
    const persistence = new InMemoryAgentRecordPersistence([
      {
        type: 'metadata',
        protocol_version: '0.9',
        created_at: 1,
      },
    ]);
    const records = testAgent({ persistence }).agent.records;

    await expect(records.replay()).rejects.toThrow('Missing wire migration for version 0.9');
  });

});

describe('agent replay range build', () => {
  it('returns the complete replay when no range is requested', async () => {
    const firstMessage = userMessage('first');
    const afterClearMessage = userMessage('after-clear');
    const persistence = new InMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      { type: 'context.append_message', message: firstMessage },
      { type: 'context.clear' },
      { type: 'context.append_message', message: afterClearMessage },
    ]);

    await expect(buildReplay(persistence)).resolves.toEqual([
      expect.objectContaining({ type: 'message', message: firstMessage }),
      expect.objectContaining({ type: 'message', message: afterClearMessage }),
    ]);
  });

  it('applies start and count to replay records instead of wire records', async () => {
    const message = userMessage('hello');
    const persistence = new RecordingInMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      {
        type: 'usage.record',
        model: 'mock-model',
        usage: { inputOther: 1, inputCacheRead: 0, inputCacheCreation: 0, output: 1 },
      },
      {
        type: 'config.update',
        cwd: process.cwd(),
        thinkingLevel: 'off',
      },
      {
        type: 'usage.record',
        model: 'mock-model',
        usage: { inputOther: 2, inputCacheRead: 0, inputCacheCreation: 0, output: 1 },
      },
      { type: 'permission.set_mode', mode: 'yolo' },
      { type: 'context.append_message', message },
    ]);

    const replay = await buildReplay(persistence, { start: 1, count: 2 });

    expect(replay).toEqual([
      expect.objectContaining({ type: 'permission_updated', mode: 'yolo' }),
      expect.objectContaining({ type: 'message', message }),
    ]);
    expect(persistence.rewrites).toEqual([]);
  });

  it('returns the last count replay records when start is omitted', async () => {
    const firstMessage = userMessage('first');
    const secondMessage = userMessage('second');
    const thirdMessage = userMessage('third');
    const persistence = new InMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      { type: 'context.append_message', message: firstMessage },
      { type: 'permission.set_mode', mode: 'auto' },
      { type: 'context.append_message', message: secondMessage },
      { type: 'context.append_message', message: thirdMessage },
    ]);

    await expect(buildReplay(persistence, { count: 2 })).resolves.toEqual([
      expect.objectContaining({ type: 'message', message: secondMessage }),
      expect.objectContaining({ type: 'message', message: thirdMessage }),
    ]);
    await expect(buildReplay(persistence, { count: 10 })).resolves.toEqual([
      expect.objectContaining({ type: 'message', message: firstMessage }),
      expect.objectContaining({ type: 'permission_updated', mode: 'auto' }),
      expect.objectContaining({ type: 'message', message: secondMessage }),
      expect.objectContaining({ type: 'message', message: thirdMessage }),
    ]);
  });

  it('continues reading all segments before returning the last count replay records', async () => {
    const beforeClearMessages = Array.from({ length: 50 }, (_item, index) =>
      userMessage(`before-clear-${String(index)}`),
    );
    const afterClearMessages = Array.from({ length: 50 }, (_item, index) =>
      userMessage(`after-clear-${String(index)}`),
    );
    const persistence = new InMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      ...beforeClearMessages.map((message) => ({ type: 'context.append_message' as const, message })),
      { type: 'context.clear' },
      ...afterClearMessages.map((message) => ({ type: 'context.append_message' as const, message })),
    ]);

    const replay = await buildReplay(persistence, { count: 10 });

    expect(replay).toHaveLength(10);
    expect(replay).toEqual(
      afterClearMessages.slice(-10).map((message) =>
        expect.objectContaining({ type: 'message', message }),
      ),
    );
  });

  it('reads beyond the requested range to patch an explicit compaction result', async () => {
    const message = userMessage('compact these facts');
    const persistence = new InMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      { type: 'context.append_message', message },
      { type: 'full_compaction.begin', source: 'manual', instruction: 'keep facts' },
      {
        type: 'context.apply_compaction',
        summary: 'Compacted summary.',
        contextSummary: 'Explicit retained facts.',
        compactedCount: 1,
        tokensBefore: 10,
        tokensAfter: 3,
      },
      { type: 'permission.set_mode', mode: 'auto' },
    ]);

    const replay = await buildReplay(persistence, { start: 1, count: 1 });
    expect(replay).toEqual([
      expect.objectContaining({
        type: 'compaction',
        instruction: 'keep facts',
        result: expect.objectContaining({
          summary: 'Compacted summary.',
          contextSummary: 'Explicit retained facts.',
          compactedCount: 1,
          tokensBefore: 10,
          keptUserMessageCount: 1,
        }),
      }),
    ]);
    const compaction = replay[0];
    if (compaction?.type !== 'compaction' || typeof compaction.result !== 'object') {
      throw new Error('Expected a completed compaction replay record');
    }
    expect(compaction.result.tokensAfter).toBeGreaterThan(0);
  });

  it('does not rewrite migrated wire records while projecting', async () => {
    const persistence = new RecordingInMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: '1.0', created_at: 1 },
      { type: 'permission.set_mode', mode: 'auto' },
    ]);

    await expect(buildReplay(persistence, { start: 0, count: 1 })).resolves.toEqual([
      expect.objectContaining({ type: 'permission_updated', mode: 'auto' }),
    ]);
    expect(persistence.rewrites).toEqual([]);
  });

  it('keeps the start offset correct when undo removes more messages than count', async () => {
    const firstMessage = userMessage('first');
    const removedBeforeStart = userMessage('removed-before-start');
    const removedAtStart = userMessage('removed-at-start');
    const removedAfterStart = userMessage('removed-after-start');
    const nextMessage = userMessage('next');
    const expectedMessage = userMessage('expected');
    const persistence = new InMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      { type: 'context.append_message', message: firstMessage },
      { type: 'context.append_message', message: removedBeforeStart },
      { type: 'context.append_message', message: removedAtStart },
      { type: 'context.append_message', message: removedAfterStart },
      { type: 'context.undo', count: 3 },
      { type: 'context.append_message', message: nextMessage },
      { type: 'context.append_message', message: expectedMessage },
    ]);

    await expect(buildReplay(persistence, { start: 2, count: 1 })).resolves.toEqual([
      expect.objectContaining({ type: 'message', message: expectedMessage }),
    ]);
  });

  it('clamps results at undo boundaries', async () => {
    const firstMessage = userMessage('first');
    const secondMessage = userMessage('second');
    const afterClearMessage = userMessage('after-clear');
    const persistence = new InMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      { type: 'context.append_message', message: firstMessage },
      { type: 'context.append_message', message: secondMessage },
      { type: 'context.clear' },
      { type: 'context.append_message', message: afterClearMessage },
    ]);

    await expect(buildReplay(persistence, { start: 0, count: 10 })).resolves.toEqual([
      expect.objectContaining({ type: 'message', message: firstMessage }),
      expect.objectContaining({ type: 'message', message: secondMessage }),
    ]);
    await expect(buildReplay(persistence, { start: 2, count: 10 })).resolves.toEqual([
      expect.objectContaining({ type: 'message', message: afterClearMessage }),
    ]);
  });
});

class RecordingInMemoryAgentRecordPersistence extends InMemoryAgentRecordPersistence {
  readonly rewrites: AgentRecord[][] = [];

  override rewrite(records: readonly AgentRecord[]): void {
    this.rewrites.push([...records]);
    super.rewrite(records);
  }
}

function userMessage(text: string): ContextMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls: [],
  };
}
