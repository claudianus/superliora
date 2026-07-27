import { describe, expect, it, vi, type Mock } from 'vitest';

import { Agent } from '../../src/agent';
import { resolveActivePremiumDensity } from '../../src/agent/injection/premium-quality';
import type { SDKAgentRPC } from '../../src/rpc';
import { ProviderManager } from '../../src/session/provider-manager';
import { testKaos } from '../fixtures/test-kaos';

vi.mock('../../src/agent/injection/premium-quality', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/agent/injection/premium-quality')>();
  return {
    ...actual,
    resolveActivePremiumDensity: vi.fn(() => 'code'),
  };
});

const MOCK_PROVIDER = {
  type: 'kimi',
  apiKey: 'test-key',
  model: 'mock-model',
} as const;

const GATED_SCHEMA = [
  'Read',
  'Edit',
  'Bash',
  'EnterPlanMode',
  'ExitPlanMode',
  'NextPhase',
  'RecordInterviewFinding',
  'UltraworkGraph',
  'GenerateImage',
  'GenerateVideo',
  'VerifySurface',
  'VisualDiff',
  'UltraSwarm',
  'SearchExpert',
  'CreateGoal',
];

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
  agent.tools.initializeBuiltinTools();
  agent.tools.setActiveTools(GATED_SCHEMA);
  return agent;
}

function loopToolNames(agent: Agent): string[] {
  return agent.tools.loopTools.map((tool) => tool.name);
}

describe('ToolManager mode-gated schemas (T2-3)', () => {
  it('hides mode-bound tools outside their modes but keeps launch tools', () => {
    const names = loopToolNames(makeAgent());
    expect(names).not.toContain('NextPhase');
    expect(names).not.toContain('RecordInterviewFinding');
    expect(names).not.toContain('ExitPlanMode');
    expect(names).not.toContain('UltraworkGraph');
    expect(names).toContain('EnterPlanMode');
    expect(names).toContain('CreateGoal');
    // Premium is off by default, so visual tools stay available.
    expect(names).toContain('VisualDiff');
  });

  it('shows ExitPlanMode in plan mode and NextPhase only in ultra plan mode', () => {
    const agent = makeAgent();
    vi.spyOn(agent.planMode, 'isActive', 'get').mockReturnValue(true);
    let names = loopToolNames(agent);
    expect(names).toContain('ExitPlanMode');
    expect(names).not.toContain('NextPhase');

    vi.spyOn(agent.planMode, 'isUltraMode', 'get').mockReturnValue(true);
    names = loopToolNames(agent);
    expect(names).toContain('NextPhase');
    expect(names).toContain('RecordInterviewFinding');
  });

  it('shows UltraworkGraph only while an ultrawork run is active', () => {
    const agent = makeAgent();
    expect(loopToolNames(agent)).not.toContain('UltraworkGraph');
    vi.spyOn(agent.ultrawork, 'getRun').mockReturnValue({ objective: 'ship it' } as never);
    expect(loopToolNames(agent)).toContain('UltraworkGraph');
  });

  it('hides visual tools under premium code density and restores them otherwise', () => {
    const prevKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'test-key';
    try {
      const agent = makeAgent();
      const density = resolveActivePremiumDensity as Mock;

      agent.premiumQuality.setEnabled(true);
      density.mockReturnValue('code');
      let names = loopToolNames(agent);
      expect(names).not.toContain('GenerateImage');
      expect(names).not.toContain('VerifySurface');
      expect(names).not.toContain('VisualDiff');

      density.mockReturnValue('visual');
      loopToolNames(agent); // hysteresis observation 1 — block stays put
      names = loopToolNames(agent); // observation 2 — density flip applies
      expect(names).toContain('GenerateImage');
      expect(names).toContain('VerifySurface');

      agent.premiumQuality.setEnabled(false);
      density.mockReturnValue('code');
      expect(loopToolNames(agent)).toContain('GenerateImage');
    } finally {
      if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = prevKey;
    }
  });

  it('ignores a single transient density flap so the tool block stays cache-stable', () => {
    const agent = makeAgent();
    const density = resolveActivePremiumDensity as Mock;
    agent.premiumQuality.setEnabled(true);
    density.mockReturnValue('code');
    loopToolNames(agent);
    expect(loopToolNames(agent)).not.toContain('VisualDiff');

    // One transient 'visual' reading must not rewrite the tool block.
    density.mockReturnValue('visual');
    loopToolNames(agent);
    density.mockReturnValue('code');
    expect(loopToolNames(agent)).not.toContain('VisualDiff');
  });
});
