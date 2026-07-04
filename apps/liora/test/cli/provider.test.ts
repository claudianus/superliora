/**
 * `liora provider` CLI unit tests. The handlers receive an injected `getHarness`
 * + capturing stdout/stderr, so we test the wiring end-to-end without booting
 * a real harness or hitting the network.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import type { LioraConfig, ProviderRouteStatus } from '@superliora/sdk';

import {
  handleCatalogAdd,
  handleCatalogList,
  handleProviderAdd,
  handleProviderCustomAdd,
  handleProviderDoctor,
  handleProviderKeyAdd,
  handleProviderKeyClear,
  handleProviderKeyLabel,
  handleProviderKeyLimit,
  handleProviderKeyList,
  handleProviderKeyPromote,
  handleProviderKeyRemove,
  handleProviderKeyUnlabel,
  handleProviderList,
  handleProviderOAuthAdd,
  handleProviderOAuthClear,
  handleProviderOAuthLabel,
  handleProviderOAuthList,
  handleProviderOAuthPromote,
  handleProviderOAuthRemove,
  handleProviderOAuthUnlabel,
  handleProviderRemove,
  handleProviderRouteAuto,
  handleProviderRoutePreview,
  handleProviderRouteReset,
  handleProviderRouteSet,
  handleProviderRouteShow,
  handleProviderRouteStatus,
  handleProviderUse,
  registerProviderCommand,
  type ProviderDeps,
} from '#/cli/sub/provider';

class ExitCalled extends Error {
  constructor(public readonly code: number) {
    super(`exit(${code})`);
  }
}

interface FakeHarness {
  ensureConfigFile: () => Promise<void>;
  getConfig: () => Promise<LioraConfig>;
  setConfig: (patch: Partial<LioraConfig>) => Promise<LioraConfig>;
  removeProvider: (providerId: string) => Promise<LioraConfig>;
  resumeSession?: (input: { id: string }) => Promise<{
    getStatus?: () => Promise<{ providerRouteStatus?: ProviderRouteStatus | null }>;
    resetProviderRouteStatus?: () => Promise<{
      modelAlias: string;
      candidates: unknown[];
    } | null>;
  }>;
}

function makeHarness(initial: LioraConfig): {
  harness: FakeHarness;
  current: () => LioraConfig;
  setConfigCalls: Array<Partial<LioraConfig>>;
  removeCalls: string[];
} {
  // `persisted` simulates the on-disk config; the real RPC's `removeProvider`
  // reads from / writes to disk on every call (see
  // `packages/agent-core/src/rpc/core-impl.ts removeKimiProvider`). Tests must
  // model this: anything the handler builds up in its in-memory `config`
  // object disappears unless it is flushed via `setConfig` BEFORE the next
  // `removeProvider`.
  let persisted: LioraConfig = structuredClone(initial);
  const setConfigCalls: Array<Partial<LioraConfig>> = [];
  const removeCalls: string[] = [];
  const harness: FakeHarness = {
    ensureConfigFile: async () => {},
    getConfig: async () => structuredClone(persisted),
    setConfig: async (patch) => {
      setConfigCalls.push(structuredClone(patch));
      // Mirror the real `setKimiConfig`: deep-merge with undefined keys
      // skipped (see `agent-core/src/config/merge.ts deepMerge`). This is
      // load-bearing for tests that assert `setConfig({defaultModel:
      // undefined})` does NOT wipe a key from disk — only `removeProvider`
      // can.
      const next: Record<string, unknown> = { ...persisted };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        next[key] = value;
      }
      persisted = next as LioraConfig;
      return structuredClone(persisted);
    },
    removeProvider: async (providerId) => {
      removeCalls.push(providerId);
      const nextProviders = { ...persisted.providers };
      delete nextProviders[providerId];
      const nextModels = { ...persisted.models };
      let removedDefault = false;
      for (const [alias, model] of Object.entries(nextModels)) {
        if (model.provider === providerId) {
          delete nextModels[alias];
          if (persisted.defaultModel === alias) removedDefault = true;
        }
      }
      persisted = { ...persisted, providers: nextProviders, models: nextModels };
      if (removedDefault) persisted = { ...persisted, defaultModel: undefined };
      return structuredClone(persisted);
    },
  };
  return {
    harness,
    current: () => persisted,
    setConfigCalls,
    removeCalls,
  };
}

function makeDeps(
  harness: FakeHarness,
  overrides: Partial<ProviderDeps> = {},
): {
  deps: ProviderDeps;
  stdout: string[];
  stderr: string[];
  exitCodes: number[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const deps: ProviderDeps = {
    getHarness: () => harness as unknown as ProviderDeps extends { getHarness: () => infer R }
      ? R
      : never,
    stdout: {
      write: (chunk: string) => {
        stdout.push(chunk);
        return true;
      },
    },
    stderr: {
      write: (chunk: string) => {
        stderr.push(chunk);
        return true;
      },
    },
    env: {},
    exit: ((code: number) => {
      exitCodes.push(code);
      throw new ExitCalled(code);
    }) as ProviderDeps['exit'],
    ...overrides,
  };
  return { deps, stdout, stderr, exitCodes };
}

async function tryRun<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ExitCalled) return undefined;
    throw error;
  }
}

const REGISTRY_URL = 'https://registry.example.test/v1/models/api.json';
const REGISTRY_BODY = {
  kohub: {
    id: 'kohub',
    name: 'KoHub Anthropic',
    api: 'https://registry.example.test',
    type: 'anthropic',
    models: {
      'claude-opus-4-7': { id: 'claude-opus-4-7', name: 'Claude Opus 4-7', tool_call: true },
    },
  },
  'kohub-responses': {
    id: 'kohub-responses',
    name: 'KoHub Responses',
    api: 'https://registry.example.test/v1',
    type: 'openai_responses',
    models: {
      'gpt-5.5': { id: 'gpt-5.5', name: 'GPT 5.5', reasoning: true },
    },
  },
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockRegistryFetch(body: unknown = REGISTRY_BODY, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

const CATALOG_BODY = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    npm: '@ai-sdk/anthropic',
    api: 'https://api.anthropic.com',
    env: ['ANTHROPIC_API_KEY'],
    models: {
      'claude-opus-4-7': {
        id: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        limit: { context: 200_000, output: 64_000 },
        tool_call: true,
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
      'claude-haiku-4-5': {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        limit: { context: 200_000, output: 16_000 },
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
      },
    },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    npm: '@ai-sdk/openai',
    api: 'https://api.openai.com/v1',
    env: ['OPENAI_API_KEY'],
    models: {
      'gpt-5.5': {
        id: 'gpt-5.5',
        name: 'GPT 5.5',
        limit: { context: 1_048_576, output: 128_000 },
        tool_call: true,
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
    },
  },
};

describe('liora provider add', () => {
  it('imports providers and models from a custom registry, persisting source on each provider', async () => {
    const fetchMock = mockRegistryFetch();
    const { harness, current, setConfigCalls } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderAdd(deps, REGISTRY_URL, { apiKey: 'sk-test-token' }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(fetchMock).toHaveBeenCalledWith(
      REGISTRY_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test-token' }),
      }),
    );

    const finalConfig = current();
    expect(Object.keys(finalConfig.providers).toSorted()).toEqual(['kohub', 'kohub-responses']);
    const kohub = finalConfig.providers['kohub']!;
    expect(kohub.type).toBe('anthropic');
    expect(kohub.baseUrl).toBe('https://registry.example.test');
    expect(kohub.apiKey).toBe('sk-test-token');
    expect(kohub.source).toEqual({
      kind: 'apiJson',
      url: REGISTRY_URL,
      apiKey: 'sk-test-token',
    });

    expect(finalConfig.models?.['kohub/claude-opus-4-7']).toMatchObject({
      provider: 'kohub',
      model: 'claude-opus-4-7',
    });
    expect(finalConfig.models?.['kohub-responses/gpt-5.5']).toMatchObject({
      provider: 'kohub-responses',
      model: 'gpt-5.5',
    });

    // The single setConfig patch should carry both providers and models.
    expect(setConfigCalls).toHaveLength(1);
    expect(Object.keys(setConfigCalls[0]?.providers ?? {}).toSorted()).toEqual([
      'kohub',
      'kohub-responses',
    ]);

    const output = stdout.join('');
    expect(output).toContain('Imported 2 providers (2 models)');
    expect(output).toContain('- kohub');
    expect(output).toContain('- kohub-responses');
  });

  it('drops a stale provider before re-applying when the id already exists', async () => {
    mockRegistryFetch();
    const initial: LioraConfig = {
      providers: {
        kohub: {
          type: 'kimi',
          baseUrl: 'https://stale.example.test',
          apiKey: 'old',
        },
      },
      models: {
        'kohub/stale-model': {
          provider: 'kohub',
          model: 'stale-model',
          maxContextSize: 1024,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig;
    const { harness, removeCalls, current } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderAdd(deps, REGISTRY_URL, { apiKey: 'sk-new' }),
    );

    expect(exitCodes).toEqual([]);
    expect(removeCalls).toContain('kohub');
    // The stale model alias must be gone; the registry's alias must be in.
    expect(current().models?.['kohub/stale-model']).toBeUndefined();
    expect(current().models?.['kohub/claude-opus-4-7']).toBeDefined();
  });

  it('preserves newly-imported providers when a later registry entry replaces an existing id', async () => {
    // Regression test for the codex P1: `harness.removeProvider` re-reads
    // from disk on each call, so applying the loop body without flushing
    // would silently drop providers added earlier in the same iteration.
    // The handler now removes every stale id up front in a single batch.
    mockRegistryFetch();
    const initial: LioraConfig = {
      providers: {
        // The registry will replace this one.
        'kohub-responses': {
          type: 'openai_responses',
          baseUrl: 'https://stale.example.test/v1',
          apiKey: 'old',
        },
      },
      models: {
        'kohub-responses/legacy-model': {
          provider: 'kohub-responses',
          model: 'legacy-model',
          maxContextSize: 1024,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig;
    const { harness, current } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderAdd(deps, REGISTRY_URL, { apiKey: 'sk-fresh' }),
    );

    expect(exitCodes).toEqual([]);
    const final = current();
    // BOTH providers must end up in the final config — `kohub` was newly
    // added in the loop, `kohub-responses` was replaced. The old bug dropped
    // `kohub` because the second iteration's `removeProvider` reloaded a
    // disk-backed config that had not yet been persisted with `kohub`.
    expect(final.providers['kohub']).toBeDefined();
    expect(final.providers['kohub-responses']).toBeDefined();
    expect(final.providers['kohub-responses']?.apiKey).toBe('sk-fresh');
    expect(final.models?.['kohub/claude-opus-4-7']).toBeDefined();
    expect(final.models?.['kohub-responses/gpt-5.5']).toBeDefined();
    expect(final.models?.['kohub-responses/legacy-model']).toBeUndefined();
  });

  it('reads the api key from KIMI_REGISTRY_API_KEY when --api-key is omitted', async () => {
    const fetchMock = mockRegistryFetch();
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, exitCodes } = makeDeps(harness, {
      env: { KIMI_REGISTRY_API_KEY: 'sk-env-token' },
    });

    await tryRun(() => handleProviderAdd(deps, REGISTRY_URL, {}));

    expect(exitCodes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      REGISTRY_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-env-token' }),
      }),
    );
  });

  it('exits 1 with a clear message when no api key is supplied anywhere', async () => {
    const fetchMock = mockRegistryFetch();
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderAdd(deps, REGISTRY_URL, {}));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toMatch(/missing api key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exits 1 when the registry fetch fails with an HTTP error', async () => {
    mockRegistryFetch({ message: 'invalid token' }, 401);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderAdd(deps, REGISTRY_URL, { apiKey: 'sk-bad' }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toMatch(/HTTP 401/);
  });
});

describe('liora provider remove', () => {
  it('removes a provider and reports success', async () => {
    const initial: LioraConfig = {
      providers: {
        kohub: { type: 'anthropic', baseUrl: 'https://x', apiKey: 'k' },
      },
      models: {
        'kohub/m': {
          provider: 'kohub',
          model: 'm',
          maxContextSize: 1024,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig;
    const { harness, removeCalls, current } = makeHarness(initial);
    const { deps, stdout, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRemove(deps, 'kohub'));

    expect(exitCodes).toEqual([]);
    expect(removeCalls).toEqual(['kohub']);
    expect(current().providers['kohub']).toBeUndefined();
    expect(stdout.join('')).toContain('Removed provider "kohub"');
  });

  it('exits 1 when the provider id does not exist', async () => {
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRemove(deps, 'nope'));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Provider "nope" not found');
  });
});

describe('liora provider list', () => {
  const config: LioraConfig = {
    providers: {
      kohub: {
        type: 'anthropic',
        baseUrl: 'https://x',
        apiKey: 'k',
        source: { kind: 'apiJson', url: REGISTRY_URL, apiKey: 'k' },
      },
      'managed:kimi-api': {
        type: 'kimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        oauth: { storage: 'file', key: 'oauth/kimi-code' },
      },
      manual: { type: 'openai', baseUrl: 'https://y', apiKey: 'm' },
    },
    models: {
      'kohub/a': {
        provider: 'kohub',
        model: 'a',
        maxContextSize: 1024,
        capabilities: [],
        displayName: 'KoHub A',
      },
      'kohub/b': {
        provider: 'kohub',
        model: 'b',
        maxContextSize: 1024,
        capabilities: [],
      },
      'manual/x': {
        provider: 'manual',
        model: 'x',
        maxContextSize: 1024,
        capabilities: [],
      },
    },
    defaultModel: 'kohub/a',
  } as unknown as LioraConfig;

  it('renders one row per provider with counts and source labels', async () => {
    const { harness } = makeHarness(config);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleProviderList(deps, { json: false }));

    const out = stdout.join('');
    expect(out).toMatch(/kohub\s+type=anthropic\s+models=2\s+keys=1\s+source=apiJson\(/);
    expect(out).toMatch(/managed:kimi-api\s+type=kimi\s+models=0\s+keys=0\s+source=oauth/);
    expect(out).toMatch(/manual\s+type=openai\s+models=1\s+keys=1\s+source=inline/);
    expect(out).toContain('aliases: manual/x');
    expect(out).toContain('aliases: kohub/a (KoHub A), kohub/b');
    expect(out).toContain('Default model: KoHub A (kohub/a)');
  });

  it('prints a friendly message when nothing is configured', async () => {
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleProviderList(deps, { json: false }));

    expect(stdout.join('')).toContain('No providers configured');
  });

  it('emits parseable JSON with --json', async () => {
    const { harness } = makeHarness(config);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleProviderList(deps, { json: true }));

    const parsed = JSON.parse(stdout.join('')) as {
      providers: Record<string, unknown>;
      models: Record<string, unknown>;
      defaultModel?: string;
    };
    expect(Object.keys(parsed.providers).toSorted()).toEqual([
      'kohub',
      'managed:kimi-api',
      'manual',
    ]);
    expect(Object.keys(parsed.models)).toContain('kohub/a');
    expect(parsed.defaultModel).toBe('kohub/a');
  });
});

describe('liora provider custom add', () => {
  it('adds a direct custom endpoint and model alias without exposing the key', async () => {
    const { harness, current } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderCustomAdd(deps, 'local-llm', {
        baseUrl: 'http://localhost:11434/v1/',
        model: 'qwen3-coder:30b',
        apiKey: 'sk-local',
        context: '65536',
        output: '8192',
        displayName: 'Local Qwen Coder',
        setDefault: true,
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['local-llm']).toMatchObject({
      type: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-local',
      apiKeys: [],
      source: {
        kind: 'customEndpoint',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3-coder:30b',
      },
    });
    expect(current().models?.['local-llm/qwen3-coder:30b']).toMatchObject({
      provider: 'local-llm',
      model: 'qwen3-coder:30b',
      maxContextSize: 65536,
      maxOutputSize: 8192,
      capabilities: ['tool_use'],
      displayName: 'Local Qwen Coder',
    });
    expect(current().defaultModel).toBe('local-llm/qwen3-coder:30b');
    expect(stdout.join('')).toContain('Added custom endpoint provider "local-llm"');
    expect(stdout.join('')).not.toContain('sk-local');
  });

  it('requires an API key unless --keyless is used', async () => {
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderCustomAdd(deps, 'local', {
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Missing API key');
  });

  it('supports explicit keyless local endpoints', async () => {
    const { harness, current } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderCustomAdd(deps, 'ollama', {
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen',
        keyless: true,
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(current().providers['ollama']?.apiKey).toBe('no-key-required');
  });

  it('stores environment references for custom endpoint API keys', async () => {
    const { harness, current } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderCustomAdd(deps, 'hosted', {
        baseUrl: 'https://api.hosted.example/v1',
        model: 'model-a',
        apiKeyEnv: 'HOSTED_API_KEY',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['hosted']?.apiKey).toBe('{env:HOSTED_API_KEY}');
    expect(stdout.join('')).toContain('Added custom endpoint provider "hosted"');
    expect(stdout.join('')).not.toContain('HOSTED_API_KEY');
  });

  it('does not overwrite OAuth providers', async () => {
    const { harness } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
        },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderCustomAdd(deps, 'kimi', {
        baseUrl: 'https://example.test/v1',
        model: 'model',
        apiKey: 'sk-test',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('uses OAuth');
  });
});

describe('liora provider doctor', () => {
  it('reports ok for valid env-backed credential pools and routes without exposing secrets', async () => {
    const { harness } = makeHarness({
      providers: {
        primary: {
          type: 'openai',
          apiKey: '{env:OPENAI_PRIMARY_KEY}',
          apiKeys: ['env:OPENAI_SECONDARY_KEY'],
        },
        backup: { type: 'anthropic', apiKey: 'sk-backup' },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
          fallbackModels: ['backup'],
          routing: { strategy: 'round_robin' },
        },
        backup: {
          provider: 'backup',
          model: 'claude-backup',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
      defaultModel: 'primary',
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: {
        OPENAI_PRIMARY_KEY: 'sk-primary',
        OPENAI_SECONDARY_KEY: 'sk-secondary',
      },
    });

    await tryRun(() => handleProviderDoctor(deps, { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('Provider doctor: ok');
    expect(out).toContain('providers=2');
    expect(out).toContain('routes=1');
    expect(out).toContain('candidates=3');
    expect(out).not.toContain('sk-primary');
    expect(out).not.toContain('sk-secondary');
    expect(out).not.toContain('sk-backup');
  });

  it('reports missing env refs, mixed auth, and broken fallbacks without exposing secrets', async () => {
    const { harness } = makeHarness({
      providers: {
        primary: {
          type: 'openai',
          apiKey: '{env:OPENAI_PRIMARY_KEY}',
          oauth: { storage: 'file', key: 'oauth/primary-account' },
        },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
          fallbackModels: ['missing-backup'],
        },
      },
      defaultModel: 'missing-default',
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderDoctor(deps, { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('Provider doctor: 4 errors, 1 warning');
    expect(out).toContain('[error] missing_default_model');
    expect(out).toContain('[error] missing_env provider=primary env=OPENAI_PRIMARY_KEY');
    expect(out).toContain('[warning] mixed_auth provider=primary');
    expect(out).toContain('[error] missing_fallback_model model=primary');
    expect(out).toContain('[error] invalid_route model=primary');
    expect(out).not.toContain('oauth/primary-account');
  });

  it('warns when route weights reference aliases outside the route', async () => {
    const { harness } = makeHarness({
      providers: {
        primary: { type: 'openai', apiKey: 'sk-primary' },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
          routing: {
            strategy: 'weighted_round_robin',
            weights: { primary: 2, unused: 1 },
          },
        },
      },
      defaultModel: 'primary',
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderDoctor(deps, { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('Provider doctor: 0 errors, 1 warning');
    expect(out).toContain('[warning] unused_route_weight model=primary');
  });

  it('reports credential pool env, base URL, and duplicate slot problems without secrets', async () => {
    const { harness } = makeHarness({
      providers: {
        cloudflare: {
          type: 'openai',
          credentials: [
            {
              label: 'account-1',
              apiKey: '{env:CLOUDFLARE_ONE}',
              baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1',
            },
            {
              label: 'account-2',
              apiKey: '{env:CLOUDFLARE_TWO}',
              baseUrl: 'ftp://bad.example.test/v1',
            },
            {
              label: 'duplicate-account-1',
              apiKey: '{env:CLOUDFLARE_ONE}',
              baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1',
            },
          ],
        },
      },
      models: {
        primary: {
          provider: 'cloudflare',
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
      defaultModel: 'primary',
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: { CLOUDFLARE_ONE: 'sk-one' },
    });

    await tryRun(() => handleProviderDoctor(deps, { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('Provider doctor: 2 errors, 1 warning');
    expect(out).toContain('[error] missing_env provider=cloudflare env=CLOUDFLARE_TWO');
    expect(out).toContain('[error] invalid_credential_base_url provider=cloudflare');
    expect(out).toContain('[warning] duplicate_credential provider=cloudflare');
    expect(out).not.toContain('sk-one');
  });

  it('reports duplicate credential labels and invalid preferred credentials', async () => {
    const { harness } = makeHarness({
      providers: {
        openai: {
          type: 'openai',
          credentials: [
            { apiKey: 'sk-work', label: 'work' },
            { apiKey: 'sk-personal', label: 'WORK' },
          ],
        },
      },
      models: {
        primary: {
          provider: 'openai',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
          routing: {
            strategy: 'auto',
            preferredCredential: 'primary:api_key:missing',
          },
        },
      },
      defaultModel: 'primary',
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderDoctor(deps, { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('Provider doctor: 2 errors, 0 warnings');
    expect(out).toContain('[error] duplicate_credential_label provider=openai');
    expect(out).toContain('[error] invalid_preferred_credential model=primary');
    expect(out).not.toContain('sk-work');
    expect(out).not.toContain('sk-personal');
  });

  it('reports duplicate OAuth labels without exposing storage keys', async () => {
    const { harness } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/work-account', label: 'work' },
          oauths: [{ storage: 'file', key: 'oauth/backup-account', label: 'WORK' }],
        },
      },
      models: {
        primary: {
          provider: 'kimi',
          model: 'kimi-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
      defaultModel: 'primary',
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderDoctor(deps, { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('Provider doctor: 1 error, 0 warnings');
    expect(out).toContain('[error] duplicate_oauth_label provider=kimi');
    expect(out).not.toContain('oauth/work-account');
    expect(out).not.toContain('oauth/backup-account');
  });

  it('counts locally limited single-candidate routes in diagnostics', async () => {
    const { harness } = makeHarness({
      providers: {
        primary: {
          type: 'openai',
          credentials: [{ apiKey: 'sk-primary', label: 'work', rpm: 3 }],
        },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
      defaultModel: 'primary',
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderDoctor(deps, { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('Provider doctor: ok');
    expect(out).toContain('routes=1');
    expect(out).toContain('candidates=1');
    expect(out).not.toContain('sk-primary');
  });

  it('emits JSON diagnostics for automation', async () => {
    const { harness } = makeHarness({
      providers: {
        primary: { type: 'openai', apiKey: '{env:OPENAI_PRIMARY_KEY}' },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderDoctor(deps, { json: true }));

    const report = JSON.parse(stdout.join('')) as {
      ok: boolean;
      errorCount: number;
      issues: Array<{ code: string; envVar?: string }>;
    };
    expect(exitCodes).toEqual([1]);
    expect(report.ok).toBe(false);
    expect(report.errorCount).toBe(1);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'missing_env', envVar: 'OPENAI_PRIMARY_KEY' }),
    ]);
  });
});

describe('liora provider key add', () => {
  it('adds a second API key without exposing the key in output', async () => {
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyAdd(deps, 'openai', { apiKey: 'sk-two' }));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-one',
      apiKeys: ['sk-two'],
    });
    expect(setConfigCalls).toHaveLength(1);
    expect(stdout.join('')).toContain('Added API key to provider "openai"');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('can enable auto routing when an added API key creates a credential pool', async () => {
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
      models: {
        primary: {
          provider: 'openai',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', { apiKey: 'sk-two', autoRoute: true }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-one',
      apiKeys: ['sk-two'],
    });
    expect(current().models?.['primary']?.routing).toMatchObject({
      strategy: 'auto',
      sessionAffinity: true,
    });
    expect(setConfigCalls).toHaveLength(1);
    expect(stdout.join('')).toContain('Added API key to provider "openai"');
    expect(stdout.join('')).toContain('Enabled auto route for 1 model alias: primary');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('uses KIMI_PROVIDER_API_KEY when --api-key is omitted', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai' },
      },
    } as unknown as LioraConfig);
    const { deps, exitCodes } = makeDeps(harness, {
      env: { KIMI_PROVIDER_API_KEY: 'sk-env' },
    });

    await tryRun(() => handleProviderKeyAdd(deps, 'openai', {}));

    expect(exitCodes).toEqual([]);
    expect(current().providers['openai']).toMatchObject({ apiKey: 'sk-env' });
  });

  it('adds an environment reference without reading or printing the API key', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: { OPENAI_SECONDARY_KEY: 'sk-two' },
    });

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', { apiKeyEnv: 'OPENAI_SECONDARY_KEY' }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-one',
      apiKeys: ['{env:OPENAI_SECONDARY_KEY}'],
    });
    expect(stdout.join('')).toContain('Added API key to provider "openai"');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('adds multiple API keys in one config write without exposing them', async () => {
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', { apiKeys: 'sk-two, sk-three, sk-two' }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-one',
      apiKeys: ['sk-two', 'sk-three'],
    });
    expect(setConfigCalls).toHaveLength(1);
    expect(stdout.join('')).toContain('Added 2 API keys to provider "openai"');
    expect(stdout.join('')).not.toContain('sk-two');
    expect(stdout.join('')).not.toContain('sk-three');
  });

  it('adds multiple environment references in one config write', async () => {
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {
        openai: { type: 'openai' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: { OPENAI_ONE: 'sk-one', OPENAI_TWO: 'sk-two' },
    });

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', { apiKeyEnvs: 'OPENAI_ONE,OPENAI_TWO' }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: '{env:OPENAI_ONE}',
      apiKeys: ['{env:OPENAI_TWO}'],
    });
    expect(setConfigCalls).toHaveLength(1);
    expect(stdout.join('')).toContain('Added 2 API keys to provider "openai"');
    expect(stdout.join('')).not.toContain('sk-one');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('adds API key credentials with per-credential base URLs without exposing secrets', async () => {
    const { harness, current } = makeHarness({
      providers: {
        cloudflare: {
          type: 'openai',
          apiKey: 'sk-one',
          baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1',
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: { CLOUDFLARE_TWO: 'sk-two' },
    });

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'cloudflare', {
        apiKeyEnv: 'CLOUDFLARE_TWO',
        baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-2/ai/v1',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['cloudflare']).toMatchObject({
      apiKey: '',
      apiKeys: [],
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1',
      credentials: [
        { apiKey: 'sk-one' },
        {
          apiKey: '{env:CLOUDFLARE_TWO}',
          baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-2/ai/v1',
        },
      ],
    });
    expect(stdout.join('')).toContain('Added API key to provider "cloudflare"');
    expect(stdout.join('')).not.toContain('sk-one');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('adds named API key credentials without exposing secrets', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: { OPENAI_WORK_KEY: 'sk-work' },
    });

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', {
        apiKeyEnv: 'OPENAI_WORK_KEY',
        label: 'work',
        rpm: '3',
        tpm: '1000',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: '',
      apiKeys: [],
      credentials: [
        { apiKey: 'sk-one' },
        { apiKey: '{env:OPENAI_WORK_KEY}', label: 'work', rpm: 3, tpm: 1000 },
      ],
    });
    expect(stdout.join('')).toContain('Added API key to provider "openai"');
    expect(stdout.join('')).not.toContain('sk-work');
  });

  it('adds bulk API key credential labels in one config write', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', {
        apiKeys: 'sk-work,sk-personal',
        labels: 'work,personal',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: '',
      apiKeys: [],
      credentials: [
        { apiKey: 'sk-work', label: 'work' },
        { apiKey: 'sk-personal', label: 'personal' },
      ],
    });
    expect(stdout.join('')).toContain('Added 2 API keys to provider "openai"');
    expect(stdout.join('')).not.toContain('sk-work');
    expect(stdout.join('')).not.toContain('sk-personal');
  });

  it('rejects mismatched bulk credential labels', async () => {
    const { harness } = makeHarness({
      providers: {
        openai: { type: 'openai' },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', {
        apiKeys: 'sk-work,sk-personal',
        labels: 'work',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('number of --labels entries');
  });

  it('rejects invalid credential labels', async () => {
    const { harness } = makeHarness({
      providers: {
        openai: { type: 'openai' },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', {
        apiKey: 'sk-work',
        label: 'work account',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Invalid credential label');
  });

  it('rejects invalid local credential limits', async () => {
    const { harness } = makeHarness({
      providers: {
        openai: { type: 'openai' },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', {
        apiKey: 'sk-work',
        rpm: '0',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Requests per minute must be a positive integer');
  });

  it('rejects ambiguous raw and environment API key inputs', async () => {
    const { harness } = makeHarness({
      providers: {
        openai: { type: 'openai' },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderKeyAdd(deps, 'openai', {
        apiKey: 'sk-two',
        apiKeyEnv: 'OPENAI_SECONDARY_KEY',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('either raw API key options');
  });

  it('does not duplicate an already configured API key', async () => {
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one', apiKeys: ['sk-two'] },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyAdd(deps, 'openai', { apiKey: 'sk-two' }));

    expect(exitCodes).toEqual([]);
    expect(setConfigCalls).toEqual([]);
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-one',
      apiKeys: ['sk-two'],
    });
    expect(stdout.join('')).toContain('already configured');
  });

  it('rejects OAuth providers', async () => {
    const { harness } = makeHarness({
      providers: {
        oauth: {
          type: 'kimi',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
        },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyAdd(deps, 'oauth', { apiKey: 'sk-two' }));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('uses OAuth');
  });
});

describe('liora provider key management', () => {
  it('lists key slots without exposing key values', async () => {
    const { harness } = makeHarness({
      providers: {
        openai: {
          type: 'openai',
          credentials: [
            { apiKey: 'sk-one', label: 'primary', rpm: 3, tpm: 1000 },
            { apiKey: 'sk-two', label: 'backup' },
          ],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyList(deps, 'openai'));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('2 configured API keys');
    expect(out).toContain('#1  primary');
    expect(out).toContain('#2  fallback');
    expect(out).toContain('label=primary');
    expect(out).toContain('label=backup');
    expect(out).toContain('rpm=3');
    expect(out).toContain('tpm=1000');
    expect(out).not.toContain('sk-one');
    expect(out).not.toContain('sk-two');
  });

  it('removes a key by index and promotes the next key to primary', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one', apiKeys: ['sk-two', 'sk-three'] },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyRemove(deps, 'openai', '1'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-two',
      apiKeys: ['sk-three'],
    });
    expect(stdout.join('')).toContain('Removed API key #1');
    expect(stdout.join('')).not.toContain('sk-one');
  });

  it('promotes a key slot to primary without exposing key values', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one', apiKeys: ['sk-two', 'sk-three'] },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyPromote(deps, 'openai', '3'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-three',
      apiKeys: ['sk-one', 'sk-two'],
    });
    expect(stdout.join('')).toContain('Promoted API key #3 to primary');
    expect(stdout.join('')).not.toContain('sk-three');
  });

  it('labels an existing key slot without exposing key values', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one', apiKeys: ['sk-two'] },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyLabel(deps, 'openai', '2', 'work'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: '',
      apiKeys: [],
      credentials: [{ apiKey: 'sk-one' }, { apiKey: 'sk-two', label: 'work' }],
    });
    expect(stdout.join('')).toContain('Labeled API key #2');
    expect(stdout.join('')).toContain('work');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('rejects duplicate key labels when labeling an existing slot', async () => {
    const { harness } = makeHarness({
      providers: {
        openai: {
          type: 'openai',
          credentials: [
            { apiKey: 'sk-one', label: 'work' },
            { apiKey: 'sk-two', label: 'personal' },
          ],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyLabel(deps, 'openai', '2', 'WORK'));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('already used');
  });

  it('removes a key slot label without exposing key values', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: {
          type: 'openai',
          credentials: [
            { apiKey: 'sk-one', label: 'primary' },
            { apiKey: 'sk-two', label: 'work' },
          ],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyUnlabel(deps, 'openai', '2'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      credentials: [{ apiKey: 'sk-one', label: 'primary' }, { apiKey: 'sk-two' }],
    });
    expect(stdout.join('')).toContain('Removed label from API key #2');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('sets and clears local limits on an existing key slot without exposing key values', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one', apiKeys: ['sk-two'] },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderKeyLimit(deps, 'openai', '2', {
        rpm: '3',
        tpm: '1000',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: '',
      apiKeys: [],
      credentials: [{ apiKey: 'sk-one' }, { apiKey: 'sk-two', rpm: 3, tpm: 1000 }],
    });
    expect(stdout.join('')).toContain('Updated local limits for API key #2');
    expect(stdout.join('')).not.toContain('sk-two');

    await tryRun(() => handleProviderKeyLimit(deps, 'openai', '2', { clear: true }));

    expect(exitCodes).toEqual([]);
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-one',
      apiKeys: ['sk-two'],
      credentials: [],
    });
    expect(stdout.join('')).toContain('Cleared local limits for API key #2');
  });

  it('clears configured keys without deleting the provider', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-one' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyClear(deps, 'openai'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      apiKeys: [],
    });
    expect(stdout.join('')).toContain('Removed all API keys');
    expect(stdout.join('')).not.toContain('sk-one');
  });

  it('rejects invalid key indexes', async () => {
    const { harness } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderKeyRemove(deps, 'openai', '0'));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('positive integer');
  });
});

describe('liora provider oauth management', () => {
  it('adds OAuth account refs without exposing storage keys in output', async () => {
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {
        kimi: { type: 'kimi', apiKey: '' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderOAuthAdd(deps, 'kimi', {
        key: 'oauth/primary-account',
        storage: 'file',
        oauthHost: 'https://auth.example',
        label: 'work',
      }),
    );
    await tryRun(() =>
      handleProviderOAuthAdd(deps, 'kimi', {
        key: 'oauth/backup-account',
        storage: 'keyring',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['kimi']).toMatchObject({
      oauth: {
        storage: 'file',
        key: 'oauth/primary-account',
        oauthHost: 'https://auth.example',
        label: 'work',
      },
      oauths: [{ storage: 'keyring', key: 'oauth/backup-account' }],
    });
    expect(setConfigCalls).toHaveLength(2);
    expect(stdout.join('')).toContain('Added OAuth account ref to provider "kimi"');
    expect(stdout.join('')).not.toContain('oauth/primary-account');
    expect(stdout.join('')).not.toContain('oauth/backup-account');
  });

  it('can enable auto routing when an added OAuth ref creates an account pool', async () => {
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/primary-account', label: 'work' },
        },
      },
      models: {
        primary: {
          provider: 'kimi',
          model: 'kimi-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderOAuthAdd(deps, 'kimi', {
        key: 'oauth/backup-account',
        storage: 'file',
        label: 'backup',
        autoRoute: true,
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['kimi']).toMatchObject({
      oauth: { storage: 'file', key: 'oauth/primary-account', label: 'work' },
      oauths: [{ storage: 'file', key: 'oauth/backup-account', label: 'backup' }],
    });
    expect(current().models?.['primary']?.routing).toMatchObject({
      strategy: 'auto',
      sessionAffinity: true,
    });
    expect(setConfigCalls).toHaveLength(1);
    expect(stdout.join('')).toContain('Added OAuth account ref to provider "kimi"');
    expect(stdout.join('')).toContain('Enabled auto route for 1 model alias: primary');
    expect(stdout.join('')).not.toContain('oauth/primary-account');
    expect(stdout.join('')).not.toContain('oauth/backup-account');
  });

  it('lists OAuth account slots without exposing storage keys', async () => {
    const { harness } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          oauth: {
            storage: 'file',
            key: 'oauth/primary-account',
            oauthHost: 'https://auth.example',
            label: 'work',
          },
          oauths: [{ storage: 'keyring', key: 'oauth/backup-account' }],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderOAuthList(deps, 'kimi'));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('2 configured OAuth account refs');
    expect(out).toContain('#1  primary');
    expect(out).toContain('label=work');
    expect(out).toContain('storage=file');
    expect(out).toContain('host=https://auth.example');
    expect(out).toContain('#2  fallback');
    expect(out).toContain('storage=keyring');
    expect(out).toMatch(/fingerprint=[0-9a-f]{12}/);
    expect(out).not.toContain('oauth/primary-account');
    expect(out).not.toContain('oauth/backup-account');
  });

  it('labels and unlabels OAuth account refs without exposing storage keys', async () => {
    const { harness, current } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/primary-account' },
          oauths: [{ storage: 'file', key: 'oauth/backup-account', label: 'backup' }],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderOAuthLabel(deps, 'kimi', '1', 'work'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['kimi']).toMatchObject({
      oauth: { storage: 'file', key: 'oauth/primary-account', label: 'work' },
      oauths: [{ storage: 'file', key: 'oauth/backup-account', label: 'backup' }],
    });
    expect(stdout.join('')).toContain('Labeled OAuth account ref #1');
    expect(stdout.join('')).not.toContain('oauth/primary-account');

    await tryRun(() => handleProviderOAuthUnlabel(deps, 'kimi', '1'));

    expect(exitCodes).toEqual([]);
    expect(current().providers['kimi']).toMatchObject({
      oauth: { storage: 'file', key: 'oauth/primary-account' },
      oauths: [{ storage: 'file', key: 'oauth/backup-account', label: 'backup' }],
    });
    expect(stdout.join('')).toContain('Removed label from OAuth account ref #1');
    expect(stdout.join('')).not.toContain('oauth/backup-account');
  });

  it('rejects duplicate OAuth account labels', async () => {
    const { harness } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/primary-account', label: 'work' },
          oauths: [{ storage: 'file', key: 'oauth/backup-account', label: 'backup' }],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderOAuthLabel(deps, 'kimi', '2', 'WORK'));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('already used');
  });

  it('removes an OAuth account ref by index and promotes the next ref', async () => {
    const { harness, current } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/primary-account' },
          oauths: [{ storage: 'file', key: 'oauth/backup-account' }],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderOAuthRemove(deps, 'kimi', '1'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['kimi']).toMatchObject({
      oauth: { storage: 'file', key: 'oauth/backup-account' },
      oauths: [],
    });
    expect(stdout.join('')).toContain('Removed OAuth account ref #1');
    expect(stdout.join('')).not.toContain('oauth/primary-account');
  });

  it('promotes an OAuth account ref slot to primary without exposing storage keys', async () => {
    const { harness, current } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/primary-account' },
          oauths: [
            { storage: 'file', key: 'oauth/backup-account' },
            { storage: 'keyring', key: 'oauth/third-account' },
          ],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderOAuthPromote(deps, 'kimi', '3'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['kimi']).toMatchObject({
      oauth: { storage: 'keyring', key: 'oauth/third-account' },
      oauths: [
        { storage: 'file', key: 'oauth/primary-account' },
        { storage: 'file', key: 'oauth/backup-account' },
      ],
    });
    expect(stdout.join('')).toContain('Promoted OAuth account ref #3 to primary');
    expect(stdout.join('')).not.toContain('oauth/third-account');
  });

  it('clears OAuth account refs without deleting the provider', async () => {
    const { harness, current } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          baseUrl: 'https://api.example/v1',
          oauth: { storage: 'file', key: 'oauth/primary-account' },
          oauths: [{ storage: 'file', key: 'oauth/backup-account' }],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderOAuthClear(deps, 'kimi'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['kimi']).toMatchObject({
      type: 'kimi',
      apiKey: '',
      baseUrl: 'https://api.example/v1',
    });
    expect(current().providers['kimi']?.oauth).toBeUndefined();
    expect(current().providers['kimi']?.oauths).toBeUndefined();
    expect(stdout.join('')).toContain('Removed all OAuth account refs');
  });

  it('rejects API key providers', async () => {
    const { harness } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
    } as unknown as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderOAuthAdd(deps, 'openai', {
        key: 'oauth/openai-account',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('uses API keys');
  });

  it('does not duplicate an already configured OAuth account ref', async () => {
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/primary-account' },
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderOAuthAdd(deps, 'kimi', {
        key: 'oauth/primary-account',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(setConfigCalls).toEqual([]);
    expect(current().providers['kimi']).toMatchObject({
      oauth: { storage: 'file', key: 'oauth/primary-account' },
    });
    expect(stdout.join('')).toContain('already configured');
    expect(stdout.join('')).not.toContain('oauth/primary-account');
  });
});

describe('liora provider route', () => {
  const config: LioraConfig = {
    providers: {
      primary: { type: 'openai', apiKey: 'sk-primary' },
      backup: { type: 'anthropic', apiKey: 'sk-backup' },
    },
    models: {
      primary: {
        provider: 'primary',
        model: 'gpt-primary',
        maxContextSize: 200000,
        capabilities: [],
      },
      backup: {
        provider: 'backup',
        model: 'claude-backup',
        maxContextSize: 200000,
        capabilities: [],
      },
    },
  } as unknown as LioraConfig;

  it('shows model routing config', async () => {
    const { harness } = makeHarness({
      ...config,
      models: {
        ...config.models,
        primary: {
          ...config.models?.['primary'],
          fallbackModels: ['backup'],
          routing: {
            strategy: 'weighted_round_robin',
            cooldownMs: 120000,
            weights: { primary: 3, backup: 1 },
            sessionAffinity: true,
            preferredCredential: 'backup:api_key:1',
          },
        },
      },
    } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRouteShow(deps, 'primary'));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('fallback_models: backup');
    expect(out).toContain('strategy: weighted_round_robin');
    expect(out).toContain('weights: primary=3, backup=1');
    expect(out).toContain('session_affinity: on');
    expect(out).toContain('preferred_credential: backup:api_key:1');
    expect(out).toContain('cooldown_ms: 120000');
  });

  it('previews expanded route candidates without exposing API keys', async () => {
    const { harness } = makeHarness({
      ...config,
      providers: {
        primary: {
          type: 'openai',
          apiKey: 'sk-primary',
          apiKeys: ['{env:OPENAI_SECONDARY_KEY}', 'sk-primary'],
          baseUrl: 'https://openai.example/v1',
        },
        backup: {
          type: 'anthropic',
          oauth: { storage: 'file', key: 'oauth/anthropic' },
        },
      },
      models: {
        ...config.models,
        primary: {
          ...config.models?.['primary'],
          fallbackModels: ['backup'],
          routing: {
            strategy: 'weighted_round_robin',
            weights: { primary: 3, backup: 1 },
            sessionAffinity: true,
            preferredCredential: 'primary:api_key:2',
          },
        },
      },
    } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRoutePreview(deps, 'primary', { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('Route preview for primary');
    expect(out).toContain('strategy: weighted_round_robin');
    expect(out).toContain('fallback_models: backup');
    expect(out).toContain('session_affinity: on');
    expect(out).toContain('preferred_credential: primary:api_key:2');
    expect(out).toContain('alias=primary');
    expect(out).toContain('weight=3');
    expect(out).toContain('credential=api_key:1');
    expect(out).toContain('source=api_key');
    expect(out).toContain('credential=api_key:2');
    expect(out).toContain('credential=api_key:2  preferred');
    expect(out).toContain('source=env:OPENAI_SECONDARY_KEY');
    expect(out).toContain('alias=backup');
    expect(out).toContain('weight=1');
    expect(out).toContain('auth=oauth');
    expect(out).not.toContain('sk-primary');
  });

  it('previews expanded OAuth route candidates without exposing OAuth storage keys', async () => {
    const { harness } = makeHarness({
      ...config,
      providers: {
        primary: {
          type: 'openai',
          oauth: { storage: 'file', key: 'oauth/primary', label: 'work' },
          oauths: [{ storage: 'file', key: 'oauth/backup', label: 'backup' }],
          baseUrl: 'https://openai.example/v1',
        },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
        },
      },
    } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRoutePreview(deps, 'primary', { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('strategy: auto');
    expect(out).toContain('credential=oauth:work');
    expect(out).toContain('source=oauth');
    expect(out).toContain('credential=oauth:backup');
    expect(out).toContain('source=oauths[1]');
    expect(out).toContain('auth=oauth');
    expect(out).not.toContain('oauth/primary');
    expect(out).not.toContain('oauth/backup');
  });

  it('previews per-credential base URL overrides without exposing API keys', async () => {
    const { harness } = makeHarness({
      ...config,
      providers: {
        cloudflare: {
          type: 'openai',
          baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1',
          credentials: [
            {
              label: 'account-1',
              apiKey: 'sk-one',
              rpm: 3,
              tpm: 1000,
            },
            {
              label: 'account-2',
              apiKey: '{env:CLOUDFLARE_TWO}',
              baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-2/ai/v1',
            },
          ],
        },
      },
      models: {
        primary: {
          provider: 'cloudflare',
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          maxContextSize: 200000,
        },
      },
    } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRoutePreview(deps, 'primary', { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('credential=api_key:account-1');
    expect(out).toContain('rpm=3');
    expect(out).toContain('tpm=1000');
    expect(out).toContain('base_url=https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1');
    expect(out).toContain('credential=api_key:account-2');
    expect(out).toContain('source=env:CLOUDFLARE_TWO');
    expect(out).toContain('base_url=https://api.cloudflare.com/client/v4/accounts/account-2/ai/v1');
    expect(out).not.toContain('sk-one');
  });

  it('previews a single locally limited credential as an active route', async () => {
    const { harness } = makeHarness({
      ...config,
      providers: {
        primary: {
          type: 'openai',
          credentials: [{ apiKey: 'sk-primary', label: 'work', rpm: 3, tpm: 1000 }],
        },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
        },
      },
    } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRoutePreview(deps, 'primary', { json: false }));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(out).toContain('active: yes');
    expect(out).toContain('strategy: auto');
    expect(out).toContain('credential=api_key:work');
    expect(out).toContain('rpm=3');
    expect(out).toContain('tpm=1000');
    expect(out).not.toContain('sk-primary');
  });

  it('emits route preview as JSON', async () => {
    const { harness } = makeHarness({
      ...config,
      providers: {
        primary: {
          type: 'openai',
          apiKey: '{env:OPENAI_PRIMARY_KEY}',
          apiKeys: ['env:OPENAI_SECONDARY_KEY'],
        },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRoutePreview(deps, 'primary', { json: true }));

    const preview = JSON.parse(stdout.join('')) as {
      modelAlias: string;
      strategy: string;
      active: boolean;
      candidates: Array<{ credentialSource: string; credentialLabel?: string }>;
    };
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(preview).toMatchObject({
      modelAlias: 'primary',
      strategy: 'auto',
      active: true,
    });
    expect(preview.candidates).toEqual([
      expect.objectContaining({
        credentialLabel: 'api_key:1',
        credentialSource: 'env:OPENAI_PRIMARY_KEY',
      }),
      expect.objectContaining({
        credentialLabel: 'api_key:2',
        credentialSource: 'env:OPENAI_SECONDARY_KEY',
      }),
    ]);
  });

  it('enables auto routing for a credential pool and prints a safe preview', async () => {
    const { harness, current } = makeHarness({
      ...config,
      providers: {
        primary: {
          type: 'openai',
          credentials: [
            { apiKey: 'sk-work', label: 'work', rpm: 10 },
            { apiKey: '{env:OPENAI_BACKUP}', label: 'backup', tpm: 120000 },
          ],
        },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRouteAuto(deps, 'primary', {}));

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().models?.['primary']).toMatchObject({
      routing: { strategy: 'auto', sessionAffinity: true },
    });
    expect(out).toContain('Enabled auto route for model "primary" with 2 candidates');
    expect(out).toContain('credential=api_key:work');
    expect(out).toContain('credential=api_key:backup');
    expect(out).toContain('rpm=10');
    expect(out).toContain('tpm=120000');
    expect(out).not.toContain('sk-work');
  });

  it('enables auto routing across fallback model aliases', async () => {
    const { harness, current } = makeHarness(config);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderRouteAuto(deps, 'primary', {
        fallback: 'backup',
        sessionAffinity: 'off',
        cooldownMs: '45000',
      }),
    );

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().models?.['primary']).toMatchObject({
      fallbackModels: ['backup'],
      routing: { strategy: 'auto', cooldownMs: 45000 },
    });
    expect(current().models?.['primary']?.routing?.sessionAffinity).toBeUndefined();
    expect(out).toContain('Enabled auto route for model "primary" with 2 candidates');
    expect(out).toContain('strategy: auto');
    expect(out).toContain('fallback_models: backup');
    expect(out).toContain('alias=backup');
    expect(out).not.toContain('sk-primary');
    expect(out).not.toContain('sk-backup');
  });

  it('rejects auto routing when there is only one route candidate', async () => {
    const { harness, current } = makeHarness(config);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRouteAuto(deps, 'primary', {}));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain(
      'Auto route for model "primary" needs at least two candidates',
    );
    expect(current().models?.['primary']?.routing).toBeUndefined();
  });

  it('sets fallback models, weighted strategy, cooldown, and weights', async () => {
    const { harness, current } = makeHarness(config);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderRouteSet(deps, 'primary', {
        fallback: 'backup',
        strategy: 'weighted_round_robin',
        cooldownMs: '90000',
        weights: 'primary=3,backup=1',
        sessionAffinity: 'on',
        preferredCredential: 'primary:api_key:1',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().models?.['primary']).toMatchObject({
      fallbackModels: ['backup'],
      routing: {
        strategy: 'weighted_round_robin',
        cooldownMs: 90000,
        weights: { primary: 3, backup: 1 },
        sessionAffinity: true,
        preferredCredential: 'primary:api_key:1',
      },
    });
    expect(stdout.join('')).toContain('Updated route for model "primary"');
  });

  it('clears session affinity without keeping an empty routing block', async () => {
    const { harness, current } = makeHarness({
      ...config,
      models: {
        ...config.models,
        primary: {
          ...config.models?.['primary'],
          routing: { sessionAffinity: true },
        },
      },
    } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderRouteSet(deps, 'primary', {
        sessionAffinity: 'off',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().models?.['primary']?.routing).toBeUndefined();
    expect(stdout.join('')).toContain('Updated route for model "primary"');
  });

  it('rejects preferred credential labels outside the expanded route', async () => {
    const { harness } = makeHarness(config);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderRouteSet(deps, 'primary', {
        preferredCredential: 'missing:api_key:9',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Preferred credential "missing:api_key:9"');
  });

  it('sets least-used route strategy for credential pool load balancing', async () => {
    const { harness, current } = makeHarness(config);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderRouteSet(deps, 'primary', {
        strategy: 'least_used',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().models?.['primary']).toMatchObject({
      routing: { strategy: 'least_used' },
    });
    expect(stdout.join('')).toContain('Updated route for model "primary"');
  });

  it.each(['auto', 'fill_first', 'lowest_latency', 'rate_limit_aware', 'random'] as const)(
    'sets %s route strategy for credential pool load balancing',
    async (strategy) => {
      const { harness, current } = makeHarness(config);
      const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

      await tryRun(() =>
        handleProviderRouteSet(deps, 'primary', {
          strategy,
        }),
      );

      expect(exitCodes).toEqual([]);
      expect(stderr.join('')).toBe('');
      expect(current().models?.['primary']).toMatchObject({
        routing: { strategy },
      });
      expect(stdout.join('')).toContain('Updated route for model "primary"');
    },
  );

  it('shows runtime route health for a session', async () => {
    const { harness } = makeHarness(config);
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const providerRouteStatus: ProviderRouteStatus = {
      modelAlias: 'primary',
      strategy: 'round_robin',
      sessionAffinity: true,
      preferredCredential: 'backup:api_key:2',
      candidates: [
        {
          modelAlias: 'primary',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          providerModel: 'gpt-primary',
          weight: 3,
          rateLimits: [
            {
              name: 'requests',
              limit: 100,
              remaining: 0,
              resetAt: now + 90_000,
            },
          ],
          rateLimitHeadroom: 0,
          cooldownUntil: now + 90_000,
          cooldownKind: 'rate_limit',
          lastFailureKind: 'rate_limit',
          lastFailureAt: now - 1_000,
          failureCount: 2,
        },
        {
          modelAlias: 'backup',
          providerName: 'anthropic',
          credentialLabel: 'api_key:2',
          providerModel: 'claude-backup',
          baseUrl: 'https://anthropic.example/v1',
          preferred: true,
          pinned: true,
          lastLatencyMs: 300,
          avgLatencyMs: 140,
          lastSuccessAt: now - 500,
          successCount: 3,
        },
      ],
    };
    const getStatus = vi.fn(async () => ({ providerRouteStatus }));
    const resumeSession = vi.fn(async () => ({ getStatus }));
    const { deps, stdout, stderr, exitCodes } = makeDeps({
      ...harness,
      resumeSession,
    });
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      await tryRun(() => handleProviderRouteStatus(deps, 'ses-1', { json: false }));
    } finally {
      vi.useRealTimers();
    }

    const out = stdout.join('');
    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(resumeSession).toHaveBeenCalledWith({ id: 'ses-1' });
    expect(getStatus).toHaveBeenCalledOnce();
    expect(out).toContain(
      'Route health for primary (strategy=round_robin, affinity=on, preferred=backup:api_key:2)',
    );
    expect(out).toContain('cooling 1m30s');
    expect(out).toContain('cooldown=rate_limit');
    expect(out).toContain('weight=3');
    expect(out).toContain('limits=requests:0/100@1m30s');
    expect(out).toContain('headroom=0%');
    expect(out).toContain('credential=api_key:1');
    expect(out).toContain('base_url=https://anthropic.example/v1');
    expect(out).toContain('preferred');
    expect(out).toContain('pinned');
    expect(out).toContain('latency=140ms');
    expect(out).toContain('last_latency=300ms');
    expect(out).toContain('last_failure=rate_limit');
    expect(out).toContain('ok=3');
    expect(out).not.toContain('sk-');
  });

  it('emits runtime route health as JSON', async () => {
    const { harness } = makeHarness(config);
    const providerRouteStatus: ProviderRouteStatus = {
      modelAlias: 'primary',
      strategy: 'fallback',
      candidates: [
        {
          modelAlias: 'primary',
          providerName: 'openai',
          providerModel: 'gpt-primary',
          successCount: 1,
        },
      ],
    };
    const getStatus = vi.fn(async () => ({ providerRouteStatus }));
    const resumeSession = vi.fn(async () => ({ getStatus }));
    const { deps, stdout, stderr, exitCodes } = makeDeps({
      ...harness,
      resumeSession,
    });

    await tryRun(() => handleProviderRouteStatus(deps, 'ses-1', { json: true }));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(JSON.parse(stdout.join(''))).toEqual(providerRouteStatus);
  });

  it('prints a no-op message when a session has no provider route health', async () => {
    const { harness } = makeHarness(config);
    const getStatus = vi.fn(async () => ({ providerRouteStatus: null }));
    const resumeSession = vi.fn(async () => ({ getStatus }));
    const { deps, stdout, stderr, exitCodes } = makeDeps({
      ...harness,
      resumeSession,
    });

    await tryRun(() => handleProviderRouteStatus(deps, 'ses-1', { json: false }));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('No provider route health');
  });

  it('resets runtime route health for a session', async () => {
    const { harness } = makeHarness(config);
    const resetProviderRouteStatus = vi.fn(async () => ({
      modelAlias: 'primary',
      candidates: [{}, {}],
    }));
    const resumeSession = vi.fn(async () => ({ resetProviderRouteStatus }));
    const { deps, stdout, stderr, exitCodes } = makeDeps({
      ...harness,
      resumeSession,
    });

    await tryRun(() => handleProviderRouteReset(deps, 'ses-1'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(resumeSession).toHaveBeenCalledWith({ id: 'ses-1' });
    expect(resetProviderRouteStatus).toHaveBeenCalledOnce();
    expect(stdout.join('')).toContain('Reset provider route health for "primary"');
    expect(stdout.join('')).toContain('2 candidates');
  });

  it('prints a no-op message when a session has no provider route', async () => {
    const { harness } = makeHarness(config);
    const resetProviderRouteStatus = vi.fn(async () => null);
    const resumeSession = vi.fn(async () => ({ resetProviderRouteStatus }));
    const { deps, stdout, stderr, exitCodes } = makeDeps({
      ...harness,
      resumeSession,
    });

    await tryRun(() => handleProviderRouteReset(deps, 'ses-1'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('No provider route health to reset');
  });

  it('rejects missing fallback aliases', async () => {
    const { harness } = makeHarness(config);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderRouteSet(deps, 'primary', {
        fallback: 'missing',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Fallback model "missing" is not configured');
  });

  it('rejects weights for aliases outside the route', async () => {
    const { harness } = makeHarness(config);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderRouteSet(deps, 'primary', {
        fallback: 'backup',
        weights: 'other=2',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain(
      'Route weight "other" is not the model alias or one of its fallback models',
    );
  });
});

describe('liora provider use', () => {
  const config: LioraConfig = {
    providers: {
      'managed:kimi-api': {
        type: 'kimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        oauth: { storage: 'file', key: 'oauth/kimi-code' },
      },
    },
    models: {
      'kimi-code/kimi-for-coding': {
        provider: 'managed:kimi-api',
        model: 'kimi-for-coding',
        maxContextSize: 1024,
        capabilities: [],
        displayName: 'K2.7 Code',
      },
    },
  } as unknown as LioraConfig;

  it('sets the default model to an existing alias', async () => {
    const { harness, current, setConfigCalls } = makeHarness(config);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderUse(deps, 'kimi-code/kimi-for-coding'));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(setConfigCalls).toEqual([{ defaultModel: 'kimi-code/kimi-for-coding' }]);
    expect(current().defaultModel).toBe('kimi-code/kimi-for-coding');
    expect(stdout.join('')).toContain(
      'Default model set to K2.7 Code (kimi-code/kimi-for-coding).',
    );
  });

  it('exits 1 when the model alias is not configured', async () => {
    const { harness } = makeHarness(config);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderUse(deps, 'missing/model'));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Model "missing/model" not found');
    expect(stderr.join('')).toContain('liora provider list --json');
  });
});

describe('registerProviderCommand', () => {
  it('shows the configured provider list when run without a subcommand', async () => {
    const { harness } = makeHarness({
      providers: {
        'managed:kimi-api': {
          type: 'kimi',
          baseUrl: 'https://api.kimi.com/coding/v1',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
        },
      },
      models: {
        'managed:kimi-api/k2': {
          provider: 'managed:kimi-api',
          model: 'k2',
          maxContextSize: 1024,
          capabilities: [],
        },
      },
      defaultModel: 'managed:kimi-api/k2',
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() => program.parseAsync(['node', 'kimi', 'provider'], { from: 'node' }));

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain(
      'managed:kimi-api  type=kimi  models=1  keys=0  source=oauth',
    );
    expect(stdout.join('')).toContain('aliases: managed:kimi-api/k2');
    expect(stdout.join('')).toContain('Default model: managed:kimi-api/k2');
  });

  it('routes provider use through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        'managed:kimi-api': {
          type: 'kimi',
          baseUrl: 'https://api.kimi.com/coding/v1',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
        },
      },
      models: {
        'kimi-code/kimi-for-coding': {
          provider: 'managed:kimi-api',
            model: 'kimi-for-coding',
            maxContextSize: 1024,
            capabilities: [],
            displayName: 'K2.7 Code',
          },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'use', 'kimi-code/kimi-for-coding'], {
        from: 'node',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().defaultModel).toBe('kimi-code/kimi-for-coding');
    expect(stdout.join('')).toContain(
      'Default model set to K2.7 Code (kimi-code/kimi-for-coding).',
    );
  });

  it('describes the user-facing subcommand and routes flags through commander', async () => {
    const fetchMock = mockRegistryFetch();
    const { harness, current } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, exitCodes, stdout } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    const providerCmd = program.commands.find((c) => c.name() === 'provider');
    expect(providerCmd?.description()).toMatch(/Manage LLM providers/i);

    await tryRun(() =>
      program.parseAsync(
        ['node', 'kimi', 'provider', 'add', REGISTRY_URL, '--api-key', 'sk-cli'],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      REGISTRY_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-cli' }),
      }),
    );
    expect(Object.keys(current().providers).toSorted()).toEqual(['kohub', 'kohub-responses']);
    expect(stdout.join('')).toContain('Imported 2 providers');
  });

  it('routes provider catalog env references through commander', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: { OPENAI_API_KEY: 'sk-openai' },
    });

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        [
          'node',
          'kimi',
          'provider',
          'catalog',
          'add',
          'openai',
          '--api-key-env',
          'OPENAI_API_KEY',
        ],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: '{env:OPENAI_API_KEY}',
    });
    expect(current().models?.['openai/gpt-5.5']).toBeDefined();
    expect(stdout.join('')).toContain('Imported OpenAI (openai)');
    expect(stdout.join('')).not.toContain('sk-openai');
  });

  it('routes provider key add through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        ['node', 'kimi', 'provider', 'key', 'add', 'openai', '--api-key', 'sk-two'],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({ apiKeys: ['sk-two'] });
    expect(stdout.join('')).toContain('Added API key to provider "openai"');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('routes provider key add --auto-route through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
      models: {
        primary: {
          provider: 'openai',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        [
          'node',
          'kimi',
          'provider',
          'key',
          'add',
          'openai',
          '--api-key',
          'sk-two',
          '--auto-route',
        ],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-one',
      apiKeys: ['sk-two'],
    });
    expect(current().models?.['primary']?.routing).toMatchObject({
      strategy: 'auto',
      sessionAffinity: true,
    });
    expect(stdout.join('')).toContain('Enabled auto route for 1 model alias: primary');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('routes provider key env references through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: { OPENAI_SECONDARY_KEY: 'sk-two' },
    });

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        [
          'node',
          'kimi',
          'provider',
          'key',
          'add',
          'openai',
          '--api-key-env',
          'OPENAI_SECONDARY_KEY',
          '--label',
          'work',
        ],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: '',
      apiKeys: [],
      credentials: [
        { apiKey: 'sk-one' },
        { apiKey: '{env:OPENAI_SECONDARY_KEY}', label: 'work' },
      ],
    });
    expect(stdout.join('')).toContain('Added API key to provider "openai"');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('routes provider bulk key env references through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: { OPENAI_ONE: 'sk-one', OPENAI_TWO: 'sk-two' },
    });

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        [
          'node',
          'kimi',
          'provider',
          'key',
          'add',
          'openai',
          '--api-key-envs',
          'OPENAI_ONE,OPENAI_TWO',
        ],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: '{env:OPENAI_ONE}',
      apiKeys: ['{env:OPENAI_TWO}'],
    });
    expect(stdout.join('')).toContain('Added 2 API keys to provider "openai"');
    expect(stdout.join('')).not.toContain('sk-one');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('routes provider oauth add through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        kimi: { type: 'kimi', apiKey: '' },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        [
          'node',
          'kimi',
          'provider',
          'oauth',
          'add',
          'kimi',
          '--key',
          'oauth/primary-account',
          '--storage',
          'keyring',
          '--label',
          'work',
        ],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['kimi']).toMatchObject({
      oauth: { storage: 'keyring', key: 'oauth/primary-account', label: 'work' },
      oauths: [],
    });
    expect(stdout.join('')).toContain('Added OAuth account ref to provider "kimi"');
    expect(stdout.join('')).not.toContain('oauth/primary-account');
  });

  it('routes provider oauth label and unlabel through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        kimi: {
          type: 'kimi',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/primary-account' },
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'oauth', 'label', 'kimi', '1', 'work'], {
        from: 'node',
      }),
    );
    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'oauth', 'unlabel', 'kimi', '1'], {
        from: 'node',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['kimi']).toMatchObject({
      oauth: { storage: 'file', key: 'oauth/primary-account' },
    });
    expect(stdout.join('')).toContain('Labeled OAuth account ref #1');
    expect(stdout.join('')).toContain('Removed label from OAuth account ref #1');
    expect(stdout.join('')).not.toContain('oauth/primary-account');
  });

  it('routes provider custom add through commander', async () => {
    const { harness, current } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        [
          'node',
          'kimi',
          'provider',
          'custom',
          'add',
          'local',
          '--base-url',
          'http://localhost:11434/v1',
          '--model',
          'qwen',
          '--keyless',
          '--set-default',
        ],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['local']).toMatchObject({
      type: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'no-key-required',
    });
    expect(current().defaultModel).toBe('local/qwen');
    expect(stdout.join('')).toContain('Added custom endpoint provider "local"');
  });

  it('routes provider key remove through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one', apiKeys: ['sk-two'] },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'key', 'remove', 'openai', '2'], {
        from: 'node',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({ apiKey: 'sk-one', apiKeys: [] });
    expect(stdout.join('')).toContain('Removed API key #2');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('routes provider key label and unlabel through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        openai: { type: 'openai', apiKey: 'sk-one', apiKeys: ['sk-two'] },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'key', 'label', 'openai', '2', 'work'], {
        from: 'node',
      }),
    );
    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'key', 'unlabel', 'openai', '2'], {
        from: 'node',
      }),
    );
    await tryRun(() =>
      program.parseAsync(
        ['node', 'kimi', 'provider', 'key', 'limit', 'openai', '2', '--rpm', '3'],
        { from: 'node' },
      ),
    );
    await tryRun(() =>
      program.parseAsync(
        ['node', 'kimi', 'provider', 'key', 'limit', 'openai', '2', '--clear'],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['openai']).toMatchObject({
      apiKey: 'sk-one',
      apiKeys: ['sk-two'],
      credentials: [],
    });
    expect(stdout.join('')).toContain('Labeled API key #2');
    expect(stdout.join('')).toContain('Removed label from API key #2');
    expect(stdout.join('')).toContain('Updated local limits for API key #2');
    expect(stdout.join('')).toContain('Cleared local limits for API key #2');
    expect(stdout.join('')).not.toContain('sk-two');
  });

  it('routes provider route set through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        primary: { type: 'openai', apiKey: 'sk-primary' },
        backup: { type: 'anthropic', apiKey: 'sk-backup' },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
        backup: {
          provider: 'backup',
          model: 'claude-backup',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        [
          'node',
          'kimi',
          'provider',
          'route',
          'set',
          'primary',
          '--fallback',
          'backup',
          '--strategy',
          'fallback',
          '--cooldown-ms',
          '60000',
          '--session-affinity',
          'on',
        ],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().models?.['primary']).toMatchObject({
      fallbackModels: ['backup'],
      routing: { strategy: 'fallback', cooldownMs: 60000, sessionAffinity: true },
    });
    expect(stdout.join('')).toContain('Updated route for model "primary"');
  });

  it('routes provider route preview through commander', async () => {
    const { harness } = makeHarness({
      providers: {
        primary: { type: 'openai', apiKey: 'sk-primary', apiKeys: ['{env:OPENAI_TWO}'] },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'route', 'preview', 'primary'], {
        from: 'node',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Route preview for primary');
    expect(stdout.join('')).toContain('source=env:OPENAI_TWO');
    expect(stdout.join('')).not.toContain('sk-primary');
  });

  it('routes provider route auto through commander', async () => {
    const { harness, current } = makeHarness({
      providers: {
        primary: { type: 'openai', apiKey: 'sk-primary' },
        backup: { type: 'anthropic', apiKey: 'sk-backup' },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
        backup: {
          provider: 'backup',
          model: 'claude-backup',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        [
          'node',
          'kimi',
          'provider',
          'route',
          'auto',
          'primary',
          '--fallback',
          'backup',
        ],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().models?.['primary']).toMatchObject({
      fallbackModels: ['backup'],
      routing: { strategy: 'auto', sessionAffinity: true },
    });
    expect(stdout.join('')).toContain('Enabled auto route for model "primary"');
    expect(stdout.join('')).not.toContain('sk-primary');
    expect(stdout.join('')).not.toContain('sk-backup');
  });

  it('routes provider route reset through commander', async () => {
    const { harness } = makeHarness({
      providers: {
        primary: { type: 'openai', apiKey: 'sk-primary' },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const resetProviderRouteStatus = vi.fn(async () => ({
      modelAlias: 'primary',
      candidates: [{}],
    }));
    const resumeSession = vi.fn(async () => ({ resetProviderRouteStatus }));
    const { deps, stdout, stderr, exitCodes } = makeDeps({
      ...harness,
      resumeSession,
    });

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'route', 'reset', 'ses-1'], {
        from: 'node',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(resumeSession).toHaveBeenCalledWith({ id: 'ses-1' });
    expect(resetProviderRouteStatus).toHaveBeenCalledOnce();
    expect(stdout.join('')).toContain('Reset provider route health for "primary"');
  });

  it('routes provider route status through commander', async () => {
    const { harness } = makeHarness({
      providers: {
        primary: { type: 'openai', apiKey: 'sk-primary' },
      },
      models: {
        primary: {
          provider: 'primary',
          model: 'gpt-primary',
          maxContextSize: 200000,
          capabilities: [],
        },
      },
    } as unknown as LioraConfig);
    const getStatus = vi.fn(async () => ({
      providerRouteStatus: {
        modelAlias: 'primary',
        strategy: 'fallback',
        candidates: [
          {
            modelAlias: 'primary',
            providerName: 'openai',
            providerModel: 'gpt-primary',
            successCount: 1,
          },
        ],
      } satisfies ProviderRouteStatus,
    }));
    const resumeSession = vi.fn(async () => ({ getStatus }));
    const { deps, stdout, stderr, exitCodes } = makeDeps({
      ...harness,
      resumeSession,
    });

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'route', 'status', 'ses-1'], {
        from: 'node',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(resumeSession).toHaveBeenCalledWith({ id: 'ses-1' });
    expect(getStatus).toHaveBeenCalledOnce();
    expect(stdout.join('')).toContain('Route health for primary');
  });

  it('reports write failures on stderr and exits 1 instead of crashing', async () => {
    const { harness } = makeHarness({
      providers: { kimi: { type: 'kimi' } },
    } as unknown as LioraConfig);
    // Simulate the strict write path rejecting because config.toml is invalid.
    harness.removeProvider = async () => {
      throw new Error(
        'Cannot change settings while config.toml is invalid — fix it first (run `liora doctor` for details).',
      );
    };
    const { deps, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('kimi');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(['node', 'kimi', 'provider', 'remove', 'kimi'], { from: 'node' }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Cannot change settings');
    expect(stderr.join('')).not.toContain('    at '); // no stack trace dump
  });
});

describe('liora provider catalog list', () => {
  it('lists catalog providers with wire/model counts, sorted by id', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout, exitCodes } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, undefined, { json: false }));

    expect(exitCodes).toEqual([]);
    const out = stdout.join('');
    expect(out).toMatch(/^anthropic\s+wire=anthropic\s+models=2\s+Anthropic\n/);
    expect(out).toMatch(/openai\s+wire=openai\s+models=1\s+OpenAI/);
    // anthropic before openai (alphabetical).
    expect(out.indexOf('anthropic')).toBeLessThan(out.indexOf('openai'));
  });

  it('filters case-insensitively by id and name substring', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, undefined, { json: false, filter: 'open' }));

    const out = stdout.join('');
    expect(out).toContain('openai');
    expect(out).not.toContain('anthropic');
  });

  it('drills into a specific providerId and lists its models with capabilities', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, 'anthropic', { json: false }));

    const out = stdout.join('');
    expect(out).toMatch(/^Anthropic \(anthropic\)/);
    expect(out).toMatch(/claude-opus-4-7\s+ctx=200000.*tool_use.*thinking.*image_in/);
    expect(out).toMatch(/claude-haiku-4-5\s+ctx=200000.*tool_use/);
  });

  it('exits 1 when the requested providerId is missing from the catalog', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, 'unknown', { json: false }));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Provider "unknown" not found in catalog');
  });

  it('emits parseable JSON for the providerId view', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, 'openai', { json: true }));

    const parsed = JSON.parse(stdout.join('')) as {
      providerId: string;
      models: Array<{ id: string }>;
    };
    expect(parsed.providerId).toBe('openai');
    expect(parsed.models.map((m) => m.id)).toEqual(['gpt-5.5']);
  });

  it('honors --url override when supplied', async () => {
    const fetchMock = mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogList(deps, undefined, { json: true, url: 'https://example.test/catalog.json' }),
    );

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/catalog.json', expect.any(Object));
  });
});

describe('liora provider catalog add', () => {
  it('imports a provider from the catalog without changing the default model', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const initial: LioraConfig = {
      providers: {
        other: { type: 'kimi', baseUrl: 'https://x', apiKey: 'k' },
      },
      models: {
        'other/main': {
          provider: 'other',
          model: 'main',
          maxContextSize: 1024,
          capabilities: [],
        },
      },
      defaultModel: 'other/main',
      defaultThinking: true,
    } as unknown as LioraConfig;
    const { harness, current, setConfigCalls } = makeHarness(initial);
    const { deps, stdout, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', { apiKey: 'sk-ant-token' }),
    );

    expect(exitCodes).toEqual([]);
    const finalConfig = current();
    expect(finalConfig.providers['anthropic']).toMatchObject({
      type: 'anthropic',
      apiKey: 'sk-ant-token',
    });
    // Catalog import populates the model aliases.
    expect(finalConfig.models?.['anthropic/claude-opus-4-7']).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    });
    expect(finalConfig.models?.['anthropic/claude-haiku-4-5']).toBeDefined();
    // The unrelated provider's model survives, and remains the default.
    expect(finalConfig.models?.['other/main']).toBeDefined();
    expect(finalConfig.defaultModel).toBe('other/main');
    expect(finalConfig.defaultThinking).toBe(true);
    // The patch sent over `setConfig` must explicitly carry the preserved default.
    expect(setConfigCalls[0]?.defaultModel).toBe('other/main');
    expect(stdout.join('')).toContain('Imported Anthropic (anthropic)');
  });

  it('sets default_model when --default-model is supplied and the model exists', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {},
    } as LioraConfig);
    const { deps, stdout, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', {
        apiKey: 'sk-ant-token',
        defaultModel: 'claude-opus-4-7',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(current().defaultModel).toBe('anthropic/claude-opus-4-7');
    expect(setConfigCalls[0]?.defaultModel).toBe('anthropic/claude-opus-4-7');
    expect(stdout.join('')).toContain('Default model set to anthropic/claude-opus-4-7');
  });

  it('can store catalog provider API keys as environment references', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness, {
      env: { ANTHROPIC_API_KEY: 'sk-ant-token' },
    });

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', { apiKeyEnv: 'ANTHROPIC_API_KEY' }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(current().providers['anthropic']).toMatchObject({
      type: 'anthropic',
      apiKey: '{env:ANTHROPIC_API_KEY}',
    });
    expect(current().models?.['anthropic/claude-opus-4-7']).toBeDefined();
    expect(stdout.join('')).toContain('Imported Anthropic (anthropic)');
    expect(stdout.join('')).not.toContain('sk-ant-token');
  });

  it('rejects mixed raw and env catalog API key sources', async () => {
    const fetchMock = mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', {
        apiKey: 'sk-ant-token',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
      }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Pass either --api-key or --api-key-env');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown --default-model with a helpful hint', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', {
        apiKey: 'sk-ant-token',
        defaultModel: 'does-not-exist',
      }),
    );

    expect(exitCodes).toEqual([1]);
    const err = stderr.join('');
    expect(err).toContain('"does-not-exist" is not in provider "anthropic"');
    expect(err).toContain('liora provider catalog list anthropic');
  });

  it('preserves an existing default_model when re-importing the same provider without --default-model', async () => {
    // Regression test for the codex P2: `removeProvider` clears
    // `defaultModel` if it pointed at one of the provider's aliases. The
    // handler must capture the previous default BEFORE calling
    // `removeProvider`, otherwise rotating the api key on an already-
    // configured provider would silently wipe the user's chosen default.
    mockRegistryFetch(CATALOG_BODY);
    const initial: LioraConfig = {
      providers: {
        anthropic: {
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-old',
        },
      },
      models: {
        'anthropic/claude-opus-4-7': {
          provider: 'anthropic',
          model: 'claude-opus-4-7',
          maxContextSize: 200_000,
          capabilities: ['tool_use', 'thinking', 'image_in'],
        },
      },
      defaultModel: 'anthropic/claude-opus-4-7',
      defaultThinking: true,
    } as unknown as LioraConfig;
    const { harness, current } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', { apiKey: 'sk-rotated' }),
    );

    expect(exitCodes).toEqual([]);
    expect(current().providers['anthropic']?.apiKey).toBe('sk-rotated');
    // Previous default and thinking flag must survive the re-import.
    expect(current().defaultModel).toBe('anthropic/claude-opus-4-7');
    expect(current().defaultThinking).toBe(true);
  });

  it('preserves default_thinking when --default-model is supplied to a thinking-capable model', async () => {
    // Regression test for the codex P2: `applyCatalogProvider` always
    // assigns `defaultThinking` from `options.thinking`. Hardcoding `false`
    // silently disabled thinking even when the user previously had it on
    // and is just importing a known provider. The handler now threads the
    // previous value through.
    mockRegistryFetch(CATALOG_BODY);
    const initial: LioraConfig = {
      providers: {},
      defaultThinking: true,
    } as unknown as LioraConfig;
    const { harness, current, setConfigCalls } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', {
        apiKey: 'sk-ant',
        defaultModel: 'claude-opus-4-7',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(current().defaultModel).toBe('anthropic/claude-opus-4-7');
    expect(current().defaultThinking).toBe(true);
    expect(setConfigCalls[0]?.defaultThinking).toBe(true);
  });

  it('does not persist default_thinking=false for first-time setup with --default-model', async () => {
    // Regression test for codex P2 follow-up: previously the handler fell
    // back to `false` when `defaultThinking` was unset, but
    // `resolveThinkingLevel` treats `defaultThinking === false` as an
    // explicit "off" request. A fresh `liora provider catalog add
    // anthropic --default-model claude-opus-4-7` must NOT silently disable
    // thinking — it should leave `defaultThinking` unset so the runtime
    // uses the per-model default.
    mockRegistryFetch(CATALOG_BODY);
    // Note: `defaultThinking` is omitted on purpose to model a fresh user.
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {},
    } as LioraConfig);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', {
        apiKey: 'sk-ant',
        defaultModel: 'claude-opus-4-7',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(current().defaultModel).toBe('anthropic/claude-opus-4-7');
    // Must NOT be `false`. `undefined` lets the runtime resolver pick the
    // per-model default; `false` would force `'off'`.
    expect(current().defaultThinking).toBeUndefined();
    expect(setConfigCalls[0]?.defaultThinking).toBeUndefined();
  });

  it('drops a stale default_model when the catalog refresh no longer contains it', async () => {
    // Regression test for codex P2: when the user previously chose
    // `anthropic/legacy` as default and a refresh of the same provider no
    // longer ships that model, restoring the previous default would point
    // `default_model` at a non-existent alias and break the next session.
    // The handler now checks whether the alias still resolves and clears
    // it otherwise.
    mockRegistryFetch(CATALOG_BODY);
    const initial: LioraConfig = {
      providers: {
        anthropic: {
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-old',
        },
      },
      models: {
        'anthropic/legacy-claude': {
          provider: 'anthropic',
          model: 'legacy-claude',
          maxContextSize: 200_000,
          capabilities: [],
        },
      },
      defaultModel: 'anthropic/legacy-claude',
    } as unknown as LioraConfig;
    const { harness, current } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', { apiKey: 'sk-rotated' }),
    );

    expect(exitCodes).toEqual([]);
    // The legacy alias must have been replaced by the catalog's models.
    expect(current().models?.['anthropic/legacy-claude']).toBeUndefined();
    expect(current().models?.['anthropic/claude-opus-4-7']).toBeDefined();
    // The dangling default must NOT have been restored — it would point at
    // a non-existent alias. The handler clears it instead.
    expect(current().defaultModel).toBeUndefined();
  });

  it('falls back to KIMI_REGISTRY_API_KEY when --api-key is omitted', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, exitCodes } = makeDeps(harness, {
      env: { KIMI_REGISTRY_API_KEY: 'sk-env' },
    });

    await tryRun(() => handleCatalogAdd(deps, 'openai', {}));

    expect(exitCodes).toEqual([]);
    expect(current().providers['openai']).toMatchObject({ apiKey: 'sk-env' });
  });

  it('exits 1 when the api key is missing and skips the network', async () => {
    const fetchMock = mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleCatalogAdd(deps, 'anthropic', {}));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toMatch(/missing api key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exits 1 when the providerId is missing from the catalog', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as LioraConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogAdd(deps, 'no-such-id', { apiKey: 'sk-x' }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Provider "no-such-id" not found in catalog');
  });
});
