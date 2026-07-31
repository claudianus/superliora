import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../../../src/agent';
import {
  shouldCreateBuiltin,
  shouldRegisterLegacyCompat,
} from '../../../src/agent/tool/builtin-tools';
import type { SDKAgentRPC } from '../../../src/rpc';
import { ProviderManager } from '../../../src/session/provider/provider-manager';
import { testKaos } from '../../fixtures/test-kaos';

const MOCK_PROVIDER = {
  type: 'kimi',
  apiKey: 'test-key',
  model: 'mock-model',
} as const;

function hostWithTools(tools: readonly string[]) {
  return { enabledTools: new Set(tools) };
}

describe('shouldRegisterLegacyCompat', () => {
  const envKey = 'SUPERLIORA_HIDE_LEGACY_TOOL_NAMES';
  const showLegacyEnvKey = 'SUPERLIORA_SHOW_LEGACY_TOOL_NAMES';
  const sovereignEnvKey = 'SUPERLIORA_SOVEREIGN';

  afterEach(() => {
    delete process.env[envKey];
    delete process.env[showLegacyEnvKey];
    delete process.env[sovereignEnvKey];
  });

  it('skips legacy alias on bootstrap by default (hide-legacy product default)', () => {
    expect(
      shouldRegisterLegacyCompat(hostWithTools([]), 'LioraReview', 'Review'),
    ).toBe(false);
  });

  it('registers legacy alias on bootstrap when SHOW_LEGACY opt-out is set', () => {
    process.env[showLegacyEnvKey] = '1';
    expect(
      shouldRegisterLegacyCompat(hostWithTools([]), 'LioraReview', 'Review'),
    ).toBe(true);
  });

  it('skips legacy alias on bootstrap when hide flag is set and sovereign twin registers', () => {
    process.env[envKey] = '1';
    expect(
      shouldRegisterLegacyCompat(hostWithTools([]), 'LioraReview', 'Review'),
    ).toBe(false);
    expect(
      shouldRegisterLegacyCompat(hostWithTools([]), 'CreateUltraGoal', 'CreateGoal'),
    ).toBe(false);
    expect(
      shouldRegisterLegacyCompat(hostWithTools([]), 'UltraworkGraph', 'TaskGraph'),
    ).toBe(false);
  });

  it('skips legacy alias on bootstrap when SUPERLIORA_SOVEREIGN=1 and sovereign twin registers', () => {
    process.env[sovereignEnvKey] = '1';
    expect(
      shouldRegisterLegacyCompat(hostWithTools([]), 'LioraReview', 'Review'),
    ).toBe(false);
    expect(
      shouldRegisterLegacyCompat(hostWithTools([]), 'CreateUltraGoal', 'CreateGoal'),
    ).toBe(false);
    expect(
      shouldRegisterLegacyCompat(hostWithTools([]), 'UltraworkGraph', 'TaskGraph'),
    ).toBe(false);
  });

  it('keeps legacy alias when explicitly selected even with hide default', () => {
    expect(
      shouldRegisterLegacyCompat(
        hostWithTools(['LioraReview', 'Review', 'Read']),
        'LioraReview',
        'Review',
      ),
    ).toBe(true);
  });

  it('keeps legacy alias when explicitly selected even with SUPERLIORA_SOVEREIGN=1', () => {
    process.env[sovereignEnvKey] = '1';
    expect(
      shouldRegisterLegacyCompat(
        hostWithTools(['LioraReview', 'Review', 'Read']),
        'LioraReview',
        'Review',
      ),
    ).toBe(true);
  });

  it('does not register legacy alias when profile lists sovereign twin only', () => {
    expect(
      shouldRegisterLegacyCompat(
        hostWithTools(['Review', 'Read', 'Bash']),
        'LioraReview',
        'Review',
      ),
    ).toBe(false);
    expect(shouldCreateBuiltin(hostWithTools(['Review']), 'LioraReview')).toBe(false);
  });
});

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
    modelProvider: new ProviderManager({
      config: {
        providers: {
          test: { type: MOCK_PROVIDER.type, apiKey: MOCK_PROVIDER.apiKey },
        },
        models: {
          [MOCK_PROVIDER.model]: {
            provider: 'test',
            model: MOCK_PROVIDER.model,
            maxContextSize: 1_000_000,
          },
        },
      },
    }),
  });
  agent.config.update({
    cwd: process.cwd(),
    modelAlias: MOCK_PROVIDER.model,
  });
  return agent;
}

describe('buildBuiltinTools legacy compat env gate', () => {
  const envKey = 'SUPERLIORA_HIDE_LEGACY_TOOL_NAMES';
  const showLegacyEnvKey = 'SUPERLIORA_SHOW_LEGACY_TOOL_NAMES';
  const sovereignEnvKey = 'SUPERLIORA_SOVEREIGN';

  afterEach(() => {
    delete process.env[envKey];
    delete process.env[showLegacyEnvKey];
    delete process.env[sovereignEnvKey];
  });

  it('omits legacy review/goal/graph aliases on bootstrap by default', () => {
    const agent = makeAgent();
    agent.tools.initializeBuiltinTools();

    const names = [...agent.tools.toolInfos()].map((info) => info.name);
    expect(names).toContain('Review');
    expect(names).toContain('CreateGoal');
    expect(names).toContain('TaskGraph');
    expect(names).toContain('Expand');
    expect(names).not.toContain('LioraReview');
    expect(names).not.toContain('CreateUltraGoal');
    expect(names).not.toContain('UltraworkGraph');
    expect(names).not.toContain('LioraExpand');
  });

  it('omits legacy review/goal/graph aliases on bootstrap when hide flag is set', () => {
    process.env[envKey] = '1';
    const agent = makeAgent();
    agent.tools.initializeBuiltinTools();

    const names = [...agent.tools.toolInfos()].map((info) => info.name);
    expect(names).toContain('Review');
    expect(names).toContain('CreateGoal');
    expect(names).toContain('TaskGraph');
    expect(names).not.toContain('LioraReview');
    expect(names).not.toContain('CreateUltraGoal');
    expect(names).not.toContain('UltraworkGraph');
  });

  it('omits legacy review/goal/graph aliases on bootstrap when SUPERLIORA_SOVEREIGN=1', () => {
    process.env[sovereignEnvKey] = '1';
    const agent = makeAgent();
    agent.tools.initializeBuiltinTools();

    const names = [...agent.tools.toolInfos()].map((info) => info.name);
    expect(names).toContain('Review');
    expect(names).toContain('CreateGoal');
    expect(names).toContain('TaskGraph');
    expect(names).not.toContain('LioraReview');
    expect(names).not.toContain('CreateUltraGoal');
    expect(names).not.toContain('UltraworkGraph');
  });

  it('keeps legacy aliases on bootstrap when SHOW_LEGACY opt-out is set', () => {
    process.env[showLegacyEnvKey] = '1';
    const agent = makeAgent();
    agent.tools.initializeBuiltinTools();

    const names = [...agent.tools.toolInfos()].map((info) => info.name);
    expect(names).toContain('LioraReview');
    expect(names).toContain('CreateUltraGoal');
    expect(names).toContain('UltraworkGraph');
    expect(names).toContain('LioraExpand');
  });
});
