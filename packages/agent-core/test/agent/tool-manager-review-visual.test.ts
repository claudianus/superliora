import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import type { SDKAgentRPC } from '../../src/rpc';
import { ProviderManager } from '../../src/session/provider-manager';
import { testKaos } from '../fixtures/test-kaos';

const MOCK_PROVIDER = {
  type: 'kimi',
  apiKey: 'test-key',
  model: 'mock-model',
} as const;

function testProviderManager(): ProviderManager {
  return new ProviderManager({
    config: {
      providers: {
        test: {
          type: MOCK_PROVIDER.type,
          apiKey: MOCK_PROVIDER.apiKey,
        },
      },
      models: {
        [MOCK_PROVIDER.model]: {
          provider: 'test',
          model: MOCK_PROVIDER.model,
          maxContextSize: 1_000_000,
        },
      },
    },
  });
}

function makeAgent(): Agent {
  const rpc = {
    emitEvent: vi.fn(),
    requestApproval: vi.fn(),
    requestQuestion: vi.fn(),
    requestCredential: vi.fn(),
    toolCall: vi.fn(),
  } as unknown as SDKAgentRPC;
  const agent = new Agent({
    kaos: testKaos,
    rpc,
    modelProvider: testProviderManager(),
  });
  agent.config.update({
    cwd: process.cwd(),
    modelAlias: MOCK_PROVIDER.model,
  });
  // Bootstrap: empty enabledTools creates the full builtin set (incl. review/visual).
  agent.tools.initializeBuiltinTools();
  return agent;
}

describe('ToolManager LioraReview + VisualDiff registration', () => {
  it('creates LioraReview and VisualDiff builtins during bootstrap', () => {
    const agent = makeAgent();
    const infos = [...agent.tools.toolInfos()];
    const names = infos.map((info) => info.name);
    expect(names).toContain('LioraReview');
    expect(names).toContain('VisualDiff');

    const review = infos.find((info) => info.name === 'LioraReview');
    const visual = infos.find((info) => info.name === 'VisualDiff');
    expect(review?.source).toBe('builtin');
    expect(visual?.source).toBe('builtin');
  });

  it('activates LioraReview and VisualDiff on the loop tool list when selected', () => {
    const agent = makeAgent();
    // Activate the review/visual tools (same path profiles use after bootstrap).
    agent.tools.setActiveTools(['LioraReview', 'VisualDiff', 'Read', 'Bash']);
    agent.tools.initializeBuiltinTools();

    const infos = [...agent.tools.toolInfos()];
    expect(infos.find((info) => info.name === 'LioraReview')?.active).toBe(true);
    expect(infos.find((info) => info.name === 'VisualDiff')?.active).toBe(true);

    const loopNames = agent.tools.loopTools.map((tool) => tool.name);
    expect(loopNames).toContain('LioraReview');
    expect(loopNames).toContain('VisualDiff');
  });
});
