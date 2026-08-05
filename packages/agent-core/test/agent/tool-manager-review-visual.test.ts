import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import type { SDKAgentRPC } from '../../src/rpc';
import { ProviderManager } from '../../src/session/provider/provider-manager';
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

describe('ToolManager LioraReview + Review + VisualDiff registration', () => {
  const showLegacyEnvKey = 'SUPERLIORA_SHOW_LEGACY_TOOL_NAMES';

  afterEach(() => {
    delete process.env[showLegacyEnvKey];
  });

  it('creates Review and VisualDiff but omits LioraReview on bootstrap by default', () => {
    const agent = makeAgent();
    const infos = [...agent.tools.toolInfos()];
    const names = infos.map((info) => info.name);
    expect(names).not.toContain('LioraReview');
    expect(names).toContain('Review');
    expect(names).toContain('VisualDiff');

    const sovereignReview = infos.find((info) => info.name === 'Review');
    const visual = infos.find((info) => info.name === 'VisualDiff');
    expect(sovereignReview?.source).toBe('builtin');
    expect(visual?.source).toBe('builtin');
  });

  it('creates LioraReview, Review, and VisualDiff when SHOW_LEGACY opt-out is set', () => {
    process.env[showLegacyEnvKey] = '1';
    const agent = makeAgent();
    const infos = [...agent.tools.toolInfos()];
    const names = infos.map((info) => info.name);
    expect(names).toContain('LioraReview');
    expect(names).toContain('Review');
    expect(names).toContain('VisualDiff');

    const review = infos.find((info) => info.name === 'LioraReview');
    expect(review?.source).toBe('builtin');
  });

  it('activates Review on the loop tool list when selected', () => {
    const agent = makeAgent();
    agent.tools.setActiveTools(['Review', 'VisualDiff', 'Read', 'Bash']);
    agent.tools.initializeBuiltinTools();

    const infos = [...agent.tools.toolInfos()];
    expect(infos.find((info) => info.name === 'Review')?.active).toBe(true);
    expect(infos.find((info) => info.name === 'VisualDiff')?.active).toBe(true);

    const loopNames = agent.tools.loopTools.map((tool) => tool.name);
    expect(loopNames).toContain('Review');
    expect(loopNames).toContain('VisualDiff');
  });

  it('activates LioraReview on the loop tool list when selected (full profile compat)', () => {
    const agent = makeAgent();
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

describe('ToolManager Expand registration', () => {
  it('creates the single Expand tool on bootstrap', () => {
    const agent = makeAgent();
    const infos = [...agent.tools.toolInfos()];
    const names = infos.map((info) => info.name);
    expect(names).toContain('Expand');

    const sovereign = infos.find((info) => info.name === 'Expand');
    expect(sovereign?.helpVisibility).toBe('primary');
  });

  it('activates Expand on the loop tool list when selected', () => {
    const agent = makeAgent();
    agent.tools.setActiveTools(['Expand', 'Read', 'Bash']);
    agent.tools.initializeBuiltinTools();

    expect(agent.tools.toolInfos().find((info) => info.name === 'Expand')?.active).toBe(true);
    expect(agent.tools.loopTools.map((tool) => tool.name)).toContain('Expand');
  });
});
