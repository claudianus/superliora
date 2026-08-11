import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UNKNOWN_CAPABILITY } from '@superliora/kosong';
import type { ContentPart, ModelCapability } from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetLiveProbeCacheForTests,
  resetModelRouteHealthStoreForTests,
  sharedModelRouteHealthStore,
} from '../../src/agent/routing';
import type { LioraConfig } from '../../src/config';
import type { ProviderManager, ResolvedRuntimeProvider } from '../../src/session/provider/provider-manager';
import { SessionAPIImpl } from '../../src/session/rpc';
import type { Session } from '../../src/session';
import {
  analyzeMediaPart,
  modelSupportsMediaKind,
  selectVisionModel,
  transformMediaForNonVisionModel,
} from '../../src/session/vision-analyzer';
import type { VisionAnalyzerDeps } from '../../src/session/vision-analyzer';
import { ReadMediaFileTool } from '../../src/tools/builtin/file/read-media';
import type { ReadMediaVisionFallback, ReadMediaVisionFallbackInput } from '../../src/tools/builtin/file/read-media';
import { createFakeKaos, PERMISSIVE_WORKSPACE } from '../tools/fixtures/fake-kaos';
import { executeTool } from '../tools/fixtures/execute-tool';

const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_HEADER).toString('base64')}`;

function capabilities(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    max_context_tokens: 128_000,
    image_in: false,
    video_in: false,
    audio_in: false,
    reasoning: false,
    cache_control: false,
    ...overrides,
  };
}

const KOSONG_PROVIDER = {
  type: 'openai',
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.test/v1',
} as unknown as ResolvedRuntimeProvider['provider'];

interface FakeModelEntry {
  readonly providerName: string;
  readonly resolved: ResolvedRuntimeProvider;
  readonly withCredential?: boolean;
}

function visionResolved(
  modelAlias: string,
  providerName: string,
  overrides: Partial<ResolvedRuntimeProvider> = {},
): ResolvedRuntimeProvider {
  return {
    modelAlias,
    providerName,
    provider: { ...KOSONG_PROVIDER },
    modelCapabilities: capabilities({ image_in: true }),
    ...overrides,
  };
}

function textResolved(modelAlias: string, providerName: string): ResolvedRuntimeProvider {
  return {
    modelAlias,
    providerName,
    provider: { ...KOSONG_PROVIDER },
    modelCapabilities: capabilities(),
  };
}

function fakeProviderManager(models: Record<string, FakeModelEntry>): ProviderManager {
  const providers: Record<string, { type: string; apiKey?: string }> = {};
  for (const entry of Object.values(models)) {
    providers[entry.providerName] =
      entry.withCredential === false ? { type: 'api-key' } : { type: 'api-key', apiKey: 'sk-test' };
  }
  const config = {
    models: Object.fromEntries(
      Object.entries(models).map(([alias, entry]) => [
        alias,
        { provider: entry.providerName, model: alias, maxContextSize: 128_000 },
      ]),
    ),
    providers,
  } as unknown as LioraConfig;
  return {
    currentConfig: () => config,
    resolveProviderConfig: (model: string): ResolvedRuntimeProvider => {
      const entry = models[model];
      if (entry === undefined) throw new Error(`unknown model: ${model}`);
      return entry.resolved;
    },
  } as unknown as ProviderManager;
}

function successGenerate(text: string): VisionAnalyzerDeps['generate'] {
  return vi.fn(async () => ({
    message: { content: [{ type: 'text', text }] },
  })) as unknown as VisionAnalyzerDeps['generate'];
}

function analyzerDeps(overrides: Partial<VisionAnalyzerDeps> = {}): VisionAnalyzerDeps {
  return {
    generate: successGenerate('A settings dialog with a Save button.'),
    providerManager: fakeProviderManager({
      'vision-model': { providerName: 'moonshot', resolved: visionResolved('vision-model', 'moonshot') },
    }),
    currentModelAlias: 'text-model',
    currentCapabilities: capabilities(),
    ...overrides,
  };
}

const imagePart: ContentPart = { type: 'image_url', imageUrl: { url: PNG_DATA_URL } };
const textPart: ContentPart = { type: 'text', text: 'What does this show?' };

describe('selectVisionModel', () => {
  beforeEach(() => {
    resetModelRouteHealthStoreForTests();
    resetLiveProbeCacheForTests();
    sharedCredentialHealthStore.clear();
  });
  afterEach(() => {
    resetModelRouteHealthStoreForTests();
    resetLiveProbeCacheForTests();
    sharedCredentialHealthStore.clear();
  });

  it('prefers a vision model on the current provider', () => {
    const providerManager = fakeProviderManager({
      'alpha-vision': { providerName: 'alpha', resolved: visionResolved('alpha-vision', 'alpha') },
      'beta-vision': { providerName: 'beta', resolved: visionResolved('beta-vision', 'beta') },
      'text-current': { providerName: 'beta', resolved: textResolved('text-current', 'beta') },
    });

    const selected = selectVisionModel(providerManager, {
      kind: 'image',
      currentModelAlias: 'text-current',
    });

    expect(selected?.modelAlias).toBe('beta-vision');
  });

  it('keeps the current alias when it already has image_in', () => {
    const providerManager = fakeProviderManager({
      'alpha-vision': { providerName: 'alpha', resolved: visionResolved('alpha-vision', 'alpha') },
      'grok-current': {
        providerName: 'xai-grok',
        resolved: visionResolved('grok-current', 'xai-grok'),
      },
    });

    const selected = selectVisionModel(providerManager, {
      kind: 'image',
      currentModelAlias: 'grok-current',
    });

    expect(selected?.modelAlias).toBe('grok-current');
  });

  it('skips aliases on route-health cooldown after a failed probe', () => {
    sharedModelRouteHealthStore.markUnavailable('dead-vision', {
      kind: 'probe_fail',
      failureReason: 'empty',
    });
    const providerManager = fakeProviderManager({
      'dead-vision': { providerName: 'alpha', resolved: visionResolved('dead-vision', 'alpha') },
      'live-vision': { providerName: 'beta', resolved: visionResolved('live-vision', 'beta') },
    });

    expect(selectVisionModel(providerManager, { kind: 'image' })?.modelAlias).toBe('live-vision');
  });

  it('falls back to deterministic catalog order without a same-provider match', () => {
    const providerManager = fakeProviderManager({
      'zeta-vision': { providerName: 'zeta', resolved: visionResolved('zeta-vision', 'zeta') },
      'alpha-vision': { providerName: 'alpha', resolved: visionResolved('alpha-vision', 'alpha') },
    });

    const selected = selectVisionModel(providerManager, { kind: 'image' });

    expect(selected?.modelAlias).toBe('alpha-vision');
  });

  it('returns undefined when the only vision provider has no credentials', () => {
    const providerManager = fakeProviderManager({
      'vision-model': {
        providerName: 'moonshot',
        resolved: visionResolved('vision-model', 'moonshot'),
        withCredential: false,
      },
    });

    expect(selectVisionModel(providerManager, { kind: 'image' })).toBeUndefined();
  });

  it('returns undefined when no catalog model can consume the media kind', () => {
    const providerManager = fakeProviderManager({
      'image-only': { providerName: 'moonshot', resolved: visionResolved('image-only', 'moonshot') },
    });

    expect(selectVisionModel(providerManager, { kind: 'video' })).toBeUndefined();
  });

  it('selects a video_in model for videos', () => {
    const providerManager = fakeProviderManager({
      'image-only': { providerName: 'moonshot', resolved: visionResolved('image-only', 'moonshot') },
      'video-capable': {
        providerName: 'other',
        resolved: visionResolved('video-capable', 'other', {
          modelCapabilities: capabilities({ image_in: true, video_in: true }),
        }),
      },
    });

    expect(selectVisionModel(providerManager, { kind: 'video' })?.modelAlias).toBe('video-capable');
  });
});

describe('modelSupportsMediaKind (fail-open)', () => {
  it('treats unknown capabilities as vision-capable', () => {
    expect(modelSupportsMediaKind(undefined, 'image')).toBe(true);
    expect(modelSupportsMediaKind(UNKNOWN_CAPABILITY, 'image')).toBe(true);
    expect(modelSupportsMediaKind(UNKNOWN_CAPABILITY, 'video')).toBe(true);
  });

  it('respects declared capabilities', () => {
    expect(modelSupportsMediaKind(capabilities(), 'image')).toBe(false);
    expect(modelSupportsMediaKind(capabilities({ image_in: true }), 'image')).toBe(true);
    expect(modelSupportsMediaKind(capabilities({ image_in: true }), 'video')).toBe(false);
  });
});

describe('transformMediaForNonVisionModel', () => {
  let originalsDir = '';

  beforeEach(async () => {
    originalsDir = await mkdtemp(join(tmpdir(), 'vision-analyzer-test-'));
  });

  afterEach(async () => {
    await rm(originalsDir, { recursive: true, force: true });
  });

  it('replaces images with analyzer text and keeps other parts', async () => {
    const result = await transformMediaForNonVisionModel(
      analyzerDeps(),
      [textPart, imagePart],
      { policy: 'analyze', originalsDir },
    );

    expect(result.analyzedCount).toBe(1);
    expect(result.pathOnlyCount).toBe(0);
    expect(result.analyzerModels).toEqual(['vision-model']);
    expect(result.parts[0]).toEqual(textPart);
    const replacement = result.parts[1];
    expect(replacement?.type).toBe('text');
    if (replacement?.type !== 'text') throw new Error('expected text part');
    expect(replacement.text).toContain('[Image analysis — vision-model (image #1)]');
    expect(replacement.text).toContain('A settings dialog with a Save button.');
    expect(replacement.text).toMatch(/\[Original: .+\]/u);
  });

  it('persists the original next to the analysis text', async () => {
    const result = await transformMediaForNonVisionModel(analyzerDeps(), [imagePart], {
      policy: 'analyze',
      originalsDir,
    });
    const replacement = result.parts[0];
    if (replacement?.type !== 'text') throw new Error('expected text part');
    const match = /\[Original: (.+)\]/u.exec(replacement.text);
    expect(match?.[1]).toContain(originalsDir);
  });

  it('falls back to a path note when the analyzer call fails', async () => {
    const generate = vi.fn(async () => {
      throw new Error('provider down');
    }) as unknown as VisionAnalyzerDeps['generate'];
    const result = await transformMediaForNonVisionModel(analyzerDeps({ generate }), [imagePart], {
      policy: 'analyze',
      originalsDir,
    });

    expect(result.analyzedCount).toBe(0);
    expect(result.pathOnlyCount).toBe(1);
    const replacement = result.parts[0];
    if (replacement?.type !== 'text') throw new Error('expected text part');
    expect(replacement.text).toMatch(
      /^\[Image attached but model is text-only: .+ — analyze with a vision-capable tool\]$/u,
    );
  });

  it('emits path notes without calling the model under policy path', async () => {
    const generate = successGenerate('never used');
    const result = await transformMediaForNonVisionModel(analyzerDeps({ generate }), [imagePart], {
      policy: 'path',
      originalsDir,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.pathOnlyCount).toBe(1);
    const replacement = result.parts[0];
    if (replacement?.type !== 'text') throw new Error('expected text part');
    expect(replacement.text).toContain('model is text-only');
  });

  it('passes parts through when the current model supports the media', async () => {
    const generate = successGenerate('never used');
    const result = await transformMediaForNonVisionModel(
      analyzerDeps({ generate, currentCapabilities: capabilities({ image_in: true }) }),
      [textPart, imagePart],
      { policy: 'analyze', originalsDir },
    );

    expect(generate).not.toHaveBeenCalled();
    expect(result.analyzedCount).toBe(0);
    expect(result.parts).toEqual([textPart, imagePart]);
  });

  it('passes parts through when capabilities are unknown (fail-open)', async () => {
    const generate = successGenerate('never used');
    const result = await transformMediaForNonVisionModel(
      analyzerDeps({ generate, currentCapabilities: UNKNOWN_CAPABILITY }),
      [imagePart],
      { policy: 'analyze', originalsDir },
    );

    expect(generate).not.toHaveBeenCalled();
    expect(result.parts).toEqual([imagePart]);
  });
});

describe('analyzeMediaPart', () => {
  let originalsDir = '';

  beforeEach(async () => {
    originalsDir = await mkdtemp(join(tmpdir(), 'vision-analyzer-part-test-'));
  });

  afterEach(async () => {
    await rm(originalsDir, { recursive: true, force: true });
  });

  it('returns undefined when no analyzer model is available', async () => {
    const deps = analyzerDeps({ providerManager: fakeProviderManager({}) });
    await expect(analyzeMediaPart(deps, imagePart, { originalsDir })).resolves.toBeUndefined();
  });

  it('returns undefined when the analyzer call throws', async () => {
    const generate = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as VisionAnalyzerDeps['generate'];
    await expect(
      analyzeMediaPart(analyzerDeps({ generate }), imagePart, { originalsDir }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when the analyzer replies with no text', async () => {
    const generate = vi.fn(async () => ({
      message: { content: [] },
    })) as unknown as VisionAnalyzerDeps['generate'];
    await expect(
      analyzeMediaPart(analyzerDeps({ generate }), imagePart, { originalsDir }),
    ).resolves.toBeUndefined();
  });

  it('propagates the caller abort signal and returns undefined', async () => {
    const controller = new AbortController();
    const generate = vi.fn(
      (_provider, _system, _tools, _history, _callbacks, options) =>
        new Promise((_resolve, reject) => {
          const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
          signal?.addEventListener('abort', () =>{  reject(new Error('aborted')); });
        }),
    ) as unknown as VisionAnalyzerDeps['generate'];
    const pending = analyzeMediaPart(
      analyzerDeps({ generate, signal: controller.signal }),
      imagePart,
      { originalsDir, originalPath: null },
    );
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(generate).toHaveBeenCalledOnce();
  });
});

describe('ReadMediaFileTool vision fallback', () => {
  const DEFAULT_STAT = { stSize: 12 } as Awaited<ReturnType<ReturnType<typeof createFakeKaos>['stat']>>;

  function makeTextOnlyTool(fallback?: ReadMediaVisionFallback) {
    const kaos = createFakeKaos({
      stat: vi.fn().mockResolvedValue(DEFAULT_STAT) as never,
      readBytes: vi.fn().mockResolvedValue(PNG_HEADER) as never,
    });
    return new ReadMediaFileTool(
      kaos,
      PERMISSIVE_WORKSPACE,
      capabilities({ image_in: false, video_in: false }),
      undefined,
      fallback,
    );
  }

  it('still throws SkipThisTool without capability and without fallback', () => {
    expect(() => makeTextOnlyTool(undefined)).toThrow(/image_in or video_in/);
  });

  it('returns analyzer text when the fallback succeeds', async () => {
    const fallback = vi.fn(
      async (_input: ReadMediaVisionFallbackInput) => '[Image analysis — vision-model (sample.png)]\nA dialog.',
    );
    const tool = makeTextOnlyTool(fallback);
    const result = await executeTool(tool, {
      args: { path: '/workspace/sample.png' },
      signal: AbortSignal.timeout(2_000),
      turnId: 'turn-1',
      toolCallId: 'call-1',
    });

    expect(result.isError).toBeFalsy();
    expect(fallback).toHaveBeenCalledOnce();
    const input = fallback.mock.calls[0]?.[0];
    expect(input?.kind).toBe('image');
    expect(input?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const parts = result.output as ContentPart[];
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect((parts[0] as { text: string }).text).toContain('A dialog.');
  });

  it('leaves a path note when the fallback yields nothing', async () => {
    const tool = makeTextOnlyTool(async () => undefined);
    const result = await executeTool(tool, {
      args: { path: '/workspace/sample.png' },
      signal: AbortSignal.timeout(2_000),
      turnId: 'turn-1',
      toolCallId: 'call-1',
    });

    expect(result.isError).toBeFalsy();
    const parts = result.output as ContentPart[];
    expect((parts[0] as { text: string }).text).toBe(
      '[Image attached but model is text-only: /workspace/sample.png — analyze with a vision-capable tool]',
    );
  });
});

describe('SessionAPIImpl.prompt vision transform (integration)', () => {
  let originalsDir = '';

  beforeEach(async () => {
    originalsDir = await mkdtemp(join(tmpdir(), 'vision-analyzer-rpc-test-'));
  });

  afterEach(async () => {
    await rm(originalsDir, { recursive: true, force: true });
  });

  it('replaces media before queueing and emits a warning event', async () => {
    const promptSpy = vi.fn(async () => ({ result: 'ok' }));
    const agent = {
      generate: successGenerate('A modal with Cancel and Confirm buttons.'),
      config: { modelAlias: 'text-model', modelCapabilities: capabilities() },
      goal: { getGoal: () => ({ goal: undefined }) },
      rpcMethods: { prompt: promptSpy },
    };
    const emitEvent = vi.fn();
    const session = {
      options: {
        providerManager: fakeProviderManager({
          'vision-model': {
            providerName: 'moonshot',
            resolved: visionResolved('vision-model', 'moonshot'),
          },
        }),
        homedir: originalsDir,
        responseLanguage: undefined,
        interruptedWork: undefined,
      },
      metadata: { title: 'Custom', isCustomTitle: true, custom: {} },
      writeMetadata: vi.fn(async () => undefined),
      ensureAgentResumed: vi.fn(async () => agent),
      rpc: { emitEvent },
    } as unknown as Session;

    const api = new SessionAPIImpl(session);
    await api.prompt({
      agentId: 'main',
      sessionId: 's1',
      requestId: 'r1',
      input: [textPart, imagePart],
    });

    expect(promptSpy).toHaveBeenCalledOnce();
    const payload = promptSpy.mock.calls[0]?.[0] as { input: readonly ContentPart[] };
    expect(payload.input.some((part) => part.type === 'image_url')).toBe(false);
    expect(payload.input[0]).toEqual(textPart);
    const replacement = payload.input[1];
    expect(replacement?.type).toBe('text');
    if (replacement?.type !== 'text') throw new Error('expected text part');
    expect(replacement.text).toContain('[Image analysis — vision-model (image #1)]');
    expect(replacement.text).toContain('A modal with Cancel and Confirm buttons.');

    const events = emitEvent.mock.calls.map((call) => call[0]) as Array<{
      type: string;
      code?: string;
      details?: Record<string, unknown>;
    }>;
    const warning = events.find((event) => event.type === 'warning');
    expect(warning?.code).toBe('vision_analyzer.analyzed');
    expect(warning?.details).toMatchObject({ analyzerModel: 'vision-model', kind: 'image', count: 1 });
  });

  it('keeps media untouched for a vision-capable current model', async () => {
    const promptSpy = vi.fn(async () => ({ result: 'ok' }));
    const agent = {
      generate: successGenerate('never used'),
      config: { modelAlias: 'vision-current', modelCapabilities: capabilities({ image_in: true }) },
      goal: { getGoal: () => ({ goal: undefined }) },
      rpcMethods: { prompt: promptSpy },
    };
    const session = {
      options: {
        providerManager: fakeProviderManager({}),
        homedir: originalsDir,
        responseLanguage: undefined,
        interruptedWork: undefined,
      },
      metadata: { title: 'Custom', isCustomTitle: true, custom: {} },
      writeMetadata: vi.fn(async () => undefined),
      ensureAgentResumed: vi.fn(async () => agent),
      rpc: { emitEvent: vi.fn() },
    } as unknown as Session;

    const api = new SessionAPIImpl(session);
    await api.prompt({ agentId: 'main', sessionId: 's1', requestId: 'r1', input: [imagePart] });

    const payload = promptSpy.mock.calls[0]?.[0] as { input: readonly ContentPart[] };
    expect(payload.input).toEqual([imagePart]);
  });
});
