import { describe, expect, it, vi } from 'vitest';

import { DynamicInjector } from '../../../src/agent/injection/injector';
import { InjectionManager } from '../../../src/agent/injection/manager';
import { MemoryInjector } from '../../../src/agent/injection/memory';
import { TodoListReminderInjector } from '../../../src/agent/injection/todo-list';
import type { AgentMemoryRuntime } from '../../../src/memory';
import { testAgent } from '../harness/agent';

class RecordingInjector extends DynamicInjector {
  override readonly injectionVariant = 'recording_test';
  compactionCalls = 0;
  clearCalls = 0;

  override onContextClear(): void {
    this.clearCalls += 1;
    super.onContextClear();
  }

  override onContextCompacted(compactedCount: number, keptHeadCount: number = 0): void {
    this.compactionCalls += 1;
    super.onContextCompacted(compactedCount, keptHeadCount);
  }

  get observedInjectedAt(): number | null {
    return this.injectedAt;
  }

  set observedInjectedAt(value: number | null) {
    this.injectedAt = value;
  }

  protected override getInjection(): string | undefined {
    return undefined;
  }
}

class BoomInjector extends DynamicInjector {
  override readonly injectionVariant = 'boom_test';

  override onContextCompacted(_compactedCount: number, _keptHeadCount: number = 0): void {
    throw new Error('boom-compact');
  }

  protected override getInjection(): string | undefined {
    return undefined;
  }
}

function installInjectors(manager: InjectionManager, injectors: DynamicInjector[]): void {
  (manager as unknown as { injectors: DynamicInjector[] }).injectors = injectors;
}

function installMemory(
  agent: ReturnType<typeof testAgent>['agent'],
  getInjection = vi.fn<AgentMemoryRuntime['getInjection']>().mockResolvedValue(undefined),
): AgentMemoryRuntime {
  const memory: AgentMemoryRuntime = {
    isEnabled: () => true,
    search: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    remember: vi.fn(),
    update: vi.fn(),
    forget: vi.fn().mockResolvedValue(false),
    getInjection,
    recordTurn: vi.fn().mockResolvedValue([]),
  };
  (agent as unknown as { memory: AgentMemoryRuntime }).memory = memory;
  return memory;
}

describe('InjectionManager.onContextCompacted', () => {
  it('notifies every registered injector when compaction occurs', () => {
    const ctx = testAgent();
    ctx.configure();
    const a = new RecordingInjector(ctx.agent);
    const b = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [a, b]);

    ctx.agent.injection.onContextCompacted(3);

    expect(a.compactionCalls).toBe(1);
    expect(b.compactionCalls).toBe(1);
  });

  it('isolates compaction hook failures so later injectors still receive the notification', () => {
    const ctx = testAgent();
    ctx.configure();
    const recorder = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [new BoomInjector(ctx.agent), recorder]);

    expect(() => {
      ctx.agent.injection.onContextCompacted(2);
    }).not.toThrow();
    expect(recorder.compactionCalls).toBe(1);
  });

  it('continues notifying surviving injectors on later compactions', () => {
    const ctx = testAgent();
    ctx.configure();
    const recorder = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [new BoomInjector(ctx.agent), recorder]);

    expect(() => {
      ctx.agent.injection.onContextCompacted(1);
    }).not.toThrow();
    expect(recorder.compactionCalls).toBe(1);

    ctx.agent.injection.onContextCompacted(1);
    expect(recorder.compactionCalls).toBe(2);
  });

  it('replays context lifecycle records through ContextMemory only once', () => {
    const ctx = testAgent();
    ctx.configure();
    const recorder = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [recorder]);

    ctx.agent.records.restore({ type: 'context.clear' });
    ctx.agent.records.restore({
      type: 'context.apply_compaction',
      summary: 'Compacted summary.',
      compactedCount: 2,
      tokensBefore: 10,
      tokensAfter: 4,
    });

    expect(recorder.clearCalls).toBe(1);
    expect(recorder.compactionCalls).toBe(1);
  });

  it('shifts injectedAt by keptHeadCount so post-compaction positions are accurate', () => {
    const ctx = testAgent();
    ctx.configure();
    const recorder = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [recorder]);

    // Simulate a previous injection that landed at original index 7.
    recorder.observedInjectedAt = 7;

    // Compaction drops the first 3 messages and keeps 2 head messages in
    // front of the new summary. Post-compaction layout:
    //   [head-0, head-1, summary, ...retainedSuffix]
    // The retained-tail message at original index 7 must map to
    // `keptHeadCount(2) + 1(summary) + (7 - compactedCount(3)) = 7`.
    ctx.agent.injection.onContextCompacted(3, 2);
    expect(recorder.observedInjectedAt).toBe(7);

    // Same scenario without keptHeadCount (legacy callers / tests that
    // only pass compactedCount). The math falls back to the old formula
    // and yields 5 — a known low-severity drift that the new path fixes.
    recorder.observedInjectedAt = 7;
    ctx.agent.injection.onContextCompacted(3, 0);
    expect(recorder.observedInjectedAt).toBe(5);

    // Compacted beyond the injection clears the marker so the next
    // inject() re-emits the reminder.
    recorder.observedInjectedAt = 2;
    ctx.agent.injection.onContextCompacted(5, 0);
    expect(recorder.observedInjectedAt).toBeNull();
  });
});

describe('InjectionManager registration', () => {
  it('registers TodoListReminderInjector in the default injector chain', () => {
    const ctx = testAgent();
    ctx.configure();

    const injectors = (ctx.agent.injection as unknown as { injectors: DynamicInjector[] }).injectors;

    expect(injectors.some((injector) => injector instanceof TodoListReminderInjector)).toBe(true);
  });
});

describe('MemoryInjector', () => {
  it('ignores model-triggered skill activations when selecting a recall query', async () => {
    const ctx = testAgent();
    ctx.configure();
    const memory = installMemory(ctx.agent);

    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'Real user prompt' }]);
    ctx.agent.context.appendSystemReminder('Loaded nested skill body.', {
      kind: 'skill_activation',
      activationId: 'activation',
      skillName: 'nested-skill',
      trigger: 'model-tool',
    });

    await new MemoryInjector(ctx.agent).inject();

    expect(memory.getInjection).toHaveBeenCalledWith('Real user prompt');
  });

  it('uses user slash plugin commands as recall queries', async () => {
    const ctx = testAgent();
    ctx.configure();
    const memory = installMemory(ctx.agent);

    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'Older user prompt' }]);
    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'Plugin slash request' }], {
      kind: 'plugin_command',
      activationId: 'activation',
      pluginId: 'plugin',
      commandName: 'command',
      trigger: 'user-slash',
    });

    await new MemoryInjector(ctx.agent).inject();

    expect(memory.getInjection).toHaveBeenCalledWith('Plugin slash request');
  });
});
