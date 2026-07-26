import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '#/agent';
import { SwarmMode } from '#/agent/swarm/index';

type FakeAgent = {
  records: {
    logRecord: ReturnType<typeof vi.fn>;
    restoring: boolean;
  };
  context: {
    appendSystemReminder: ReturnType<typeof vi.fn>;
    popMatchedMessage: ReturnType<typeof vi.fn>;
  };
  emitStatusUpdated: ReturnType<typeof vi.fn>;
};

const buildAgent = (): { agent: Agent; fake: FakeAgent } => {
  const fake: FakeAgent = {
    records: { logRecord: vi.fn(), restoring: false },
    context: {
      appendSystemReminder: vi.fn(),
      popMatchedMessage: vi.fn(() => false),
    },
    emitStatusUpdated: vi.fn(),
  };
  return { agent: fake as unknown as Agent, fake };
};

describe('agent/swarm — SwarmMode', () => {
  it('starts inactive', () => {
    const { agent } = buildAgent();
    const mode = new SwarmMode(agent);
    expect(mode.isActive).toBe(false);
    expect(mode.shouldAutoExit).toBe(false);
  });

  it('enter(manual) activates, logs, and appends the enter reminder', () => {
    const { agent, fake } = buildAgent();
    const mode = new SwarmMode(agent);
    mode.enter('manual');
    expect(mode.isActive).toBe(true);
    expect(fake.records.logRecord).toHaveBeenCalledWith({
      type: 'swarm_mode.enter',
      trigger: 'manual',
    });
    expect(fake.context.appendSystemReminder).toHaveBeenCalledOnce();
    expect(fake.emitStatusUpdated).toHaveBeenCalledOnce();
    // manual trigger is not auto-exit.
    expect(mode.shouldAutoExit).toBe(false);
  });

  it('enter(tool) skips the enter reminder (silently active for tool entry)', () => {
    const { agent, fake } = buildAgent();
    const mode = new SwarmMode(agent);
    mode.enter('tool');
    expect(mode.isActive).toBe(true);
    expect(fake.context.appendSystemReminder).not.toHaveBeenCalled();
    expect(mode.shouldAutoExit).toBe(true);
  });

  it('enter on already-active mode is a no-op', () => {
    const { agent, fake } = buildAgent();
    const mode = new SwarmMode(agent);
    mode.enter('manual');
    fake.records.logRecord.mockClear();
    fake.context.appendSystemReminder.mockClear();
    mode.enter('task');
    expect(fake.records.logRecord).not.toHaveBeenCalled();
    expect(fake.context.appendSystemReminder).not.toHaveBeenCalled();
    expect(mode.isActive).toBe(true);
  });

  it('restoreEnter sets active without side effects', () => {
    const { agent, fake } = buildAgent();
    const mode = new SwarmMode(agent);
    mode.restoreEnter('manual');
    expect(mode.isActive).toBe(true);
    expect(fake.records.logRecord).not.toHaveBeenCalled();
    expect(fake.context.appendSystemReminder).not.toHaveBeenCalled();
    expect(fake.emitStatusUpdated).not.toHaveBeenCalled();
  });

  it('exit() logs exit, clears active, and emits status update', () => {
    const { agent, fake } = buildAgent();
    const mode = new SwarmMode(agent);
    mode.enter('manual');
    mode.exit();
    expect(mode.isActive).toBe(false);
    expect(fake.records.logRecord).toHaveBeenLastCalledWith({ type: 'swarm_mode.exit' });
    expect(fake.emitStatusUpdated).toHaveBeenCalledTimes(2);
  });

  it('exit() from tool trigger skips the pop + exit reminder', () => {
    const { agent, fake } = buildAgent();
    const mode = new SwarmMode(agent);
    mode.enter('tool');
    fake.context.appendSystemReminder.mockClear();
    fake.context.popMatchedMessage.mockClear();
    mode.exit();
    expect(fake.context.popMatchedMessage).not.toHaveBeenCalled();
    expect(fake.context.appendSystemReminder).not.toHaveBeenCalled();
  });

  it('exit() when popMatchedMessage handles cleanup skips the exit reminder', () => {
    const { agent, fake } = buildAgent();
    const mode = new SwarmMode(agent);
    mode.enter('manual');
    fake.context.popMatchedMessage.mockReturnValueOnce(true);
    fake.context.appendSystemReminder.mockClear();
    mode.exit();
    expect(fake.context.popMatchedMessage).toHaveBeenCalled();
    expect(fake.context.appendSystemReminder).not.toHaveBeenCalled();
  });

  it('exit() when inactive is a no-op', () => {
    const { agent, fake } = buildAgent();
    const mode = new SwarmMode(agent);
    mode.exit();
    expect(fake.records.logRecord).not.toHaveBeenCalled();
  });

  it('shouldAutoExit is true for task and tool triggers only', () => {
    const { agent } = buildAgent();
    const mode = new SwarmMode(agent);
    mode.enter('task');
    expect(mode.shouldAutoExit).toBe(true);
    mode.exit();
    mode.enter('tool');
    expect(mode.shouldAutoExit).toBe(true);
    mode.exit();
    mode.enter('manual');
    expect(mode.shouldAutoExit).toBe(false);
  });
});
