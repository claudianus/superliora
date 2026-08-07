import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import type { ResolvedAgentProfile } from '../../src/profile/resolve';
import type { Session } from '../../src/session';
import { configureSubagentChild } from '../../src/session/subagent/subagent-child-config';

vi.mock('../../src/session/subagent/subagent-telemetry', () => ({
  attachSubagentTodoBridge: vi.fn(),
}));

vi.mock('../../src/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/profile')>();
  return {
    ...actual,
    prepareSystemPromptContext: vi.fn(async () => ({})),
  };
});

vi.mock('../../src/session/subagent/subagent-model-routing', () => ({
  resolveSubagentModelSelection: vi.fn(() => ({
    alias: 'mock-model',
    thinkingLevel: undefined,
  })),
}));

function makeAgent(premiumOn: boolean): Agent {
  let enabled = premiumOn;
  const kaos = {
    getcwd: () => '/tmp',
    withCwd: () => kaos,
  };
  return {
    premiumQuality: {
      isEnabled: () => enabled,
      setEnabled: (next: boolean) => {
        enabled = next;
      },
    },
    config: { update: vi.fn(), cwd: '/tmp' },
    kaos,
    getAdditionalDirs: () => [],
    useProfile: vi.fn(),
    tools: { inheritUserTools: vi.fn() },
  } as unknown as Agent;
}

describe('configureSubagentChild — Premium Quality inheritance', () => {
  const profile = { name: 'coder' } as ResolvedAgentProfile;
  const session = {
    systemContextKaos: vi.fn(() => ({})),
    options: { kimiHomeDir: '/tmp' },
  } as unknown as Session;

  it('inherits Premium ON from the parent', async () => {
    const parent = makeAgent(true);
    const child = makeAgent(false);
    await configureSubagentChild(session, parent, child, profile, 'child_1', {
      parentToolCallId: 'tc',
      prompt: 'hi',
      description: 'd',
      runInBackground: true,
      signal: new AbortController().signal,
    });
    expect(child.premiumQuality.isEnabled()).toBe(true);
  });

  it('forces Premium ON for UI jobs even when parent is OFF', async () => {
    const parent = makeAgent(false);
    const child = makeAgent(false);
    await configureSubagentChild(session, parent, child, profile, 'child_2', {
      parentToolCallId: 'tc',
      prompt: 'hi',
      description: 'd',
      runInBackground: true,
      signal: new AbortController().signal,
      forcePremiumQuality: true,
    });
    expect(child.premiumQuality.isEnabled()).toBe(true);
  });

  it('leaves Premium OFF when parent is OFF and force is unset', async () => {
    const parent = makeAgent(false);
    const child = makeAgent(false);
    await configureSubagentChild(session, parent, child, profile, 'child_3', {
      parentToolCallId: 'tc',
      prompt: 'hi',
      description: 'd',
      runInBackground: true,
      signal: new AbortController().signal,
    });
    expect(child.premiumQuality.isEnabled()).toBe(false);
  });
});
