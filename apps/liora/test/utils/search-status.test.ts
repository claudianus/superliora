import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CHROME_RESEARCH_BRIDGE_ENV,
  NATIVE_HOST_ID,
  NATIVE_HOST_SMOKE_CACHE_TTL_MS,
  SEARCH_FREE_FALLBACK_FORCE_TIP,
  SEARCH_FREE_ONLY_KPI_TIP,
  SEARCH_NEVER_EMPTY_TELEMETRY_TIP,
  LOCAL_RESEARCH_CACHE_HIT_TIP,
  SEARCH_META_CH2_TIP,
  SEARCH_META_CH2_READY_TIP,
  SEARCH_PREFER_XAI_TIP,
  SEARXNG_URL_ENV,
  SEARCH_XAI_ENV_LINE,
  buildSearchEscalateLadderLines,
  buildSearchFreeFallbackConfigPatch,
  buildSearchSettingsStatusLines,
  clearResearchBridgeSmokeCache,
  detectSearchLateChannelEnv,
  detectSearchProviderEnvKeys,
  formatLocalResearchCacheLine,
  formatResearchBridgeHandshakeLine,
  formatSearchLateChannelOpsSuffix,
  probeNativeHostSmoke,
  resolveLocalResearchCacheStatus,
  resolveSearchFreeFallback,
} from '../../src/tui/commands/config/search/search-status';

function mockSpawnOk(stdoutText: string) {
  return {
    status: 0,
    stdout: stdoutText,
    stderr: '',
    pid: 1,
    output: [null, stdoutText, ''],
    signal: null,
    error: undefined,
  };
}

describe('detectSearchProviderEnvKeys', () => {
  it('lists configured providers from env', () => {
    const status = detectSearchProviderEnvKeys({
      BRAVE_API_KEY: 'x',
      TAVILY_API_KEY: 'y',
      GOOGLE_API_KEY: 'g',
      // missing CSE id → hint
    } as NodeJS.ProcessEnv);
    expect(status.configured).toContain('brave');
    expect(status.configured).toContain('tavily');
    expect(status.configured).toContain('google_cse');
    expect(status.freeFallback).toBe(true);
    expect(status.hints.some((h) => h.includes('CSE id'))).toBe(true);
  });

  it('detects Ch5 chrome extension bridge env', () => {
    const off = detectSearchLateChannelEnv({} as NodeJS.ProcessEnv);
    expect(off.chromeExtBridge).toBe(false);
    expect(off.nativeHandshake).toBe('off');

    const on = detectSearchLateChannelEnv({
      SUPERLIORA_CHROME_RESEARCH_BRIDGE: '1',
      SUPERLIORA_CHROME_EXT_URL: 'http://127.0.0.1:32123/search',
    } as NodeJS.ProcessEnv);
    expect(on.chromeExtBridge).toBe(true);
    expect(on.chromeExtUrl).toBe('http://127.0.0.1:32123/search');
    expect(on.nativeHandshake).toBe('env-gated');
    expect(formatSearchLateChannelOpsSuffix(on)).toContain('Ch5 chrome-ext ON');
  });

  it('accepts legacy Ch5 env alias', () => {
    const on = detectSearchLateChannelEnv({
      SUPERLIORA_CHROME_EXT_BRIDGE: '1',
    } as NodeJS.ProcessEnv);
    expect(on.chromeExtBridge).toBe(true);
    expect(on.nativeHandshake).toBe('env-gated');
  });

  it('includes Ch5 bridge setup tip in provider hints', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    expect(status.hints.some((h) => h.includes('SUPERLIORA_CHROME_RESEARCH_BRIDGE=1'))).toBe(
      true,
    );
    expect(status.hints.some((h) => h.includes('32123/search'))).toBe(true);
    expect(status.hints.some((h) => h.includes('com.superliora.research_bridge'))).toBe(true);
  });

  it('detects xAI Grok Build prefer when XAI_API_KEY is set', () => {
    const status = detectSearchProviderEnvKeys({ XAI_API_KEY: 'xai-key' } as NodeJS.ProcessEnv);
    expect(status.configured).toContain('xai_grok');
    expect(status.hints.some((h) => h.includes('PreferXai'))).toBe(true);
    expect(status.hints.some((h) => h.includes(SEARCH_PREFER_XAI_TIP))).toBe(true);
  });

  it('detects Ch2 SearXNG env and ops suffix', () => {
    const late = detectSearchLateChannelEnv({
      SUPERLIORA_SEARXNG_URL: 'http://127.0.0.1:8080',
    } as NodeJS.ProcessEnv);
    expect(late.ch2Ready).toBe(true);
    expect(late.searxngUrl).toBe('http://127.0.0.1:8080');
    expect(formatSearchLateChannelOpsSuffix(late)).toContain('Ch2 SearXNG ready');
  });

  it('prefers config searxngUrl over env', () => {
    const late = detectSearchLateChannelEnv(
      { SUPERLIORA_SEARXNG_URL: 'http://127.0.0.1:8080' } as NodeJS.ProcessEnv,
      { research: { localSearch: { searxngUrl: 'http://config.example.test/' } } },
    );
    expect(late.searxngUrl).toBe('http://config.example.test/');
    expect(late.ch2Ready).toBe(true);
  });

  it('includes free-fallback force path and Ch2 meta soft tips', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    expect(status.hints.some((h) => h.includes(SEARCH_FREE_FALLBACK_FORCE_TIP))).toBe(true);
    expect(status.hints.some((h) => h.includes(SEARCH_META_CH2_TIP))).toBe(true);
    expect(status.hints.some((h) => h.includes('SearXNG'))).toBe(true);
  });

  it('surfaces Ch2 ready tip when SUPERLIORA_SEARXNG_URL is set', () => {
    const status = detectSearchProviderEnvKeys({
      SUPERLIORA_SEARXNG_URL: 'http://127.0.0.1:8080',
    } as NodeJS.ProcessEnv);
    expect(status.hints.some((h) => h.includes(SEARCH_META_CH2_READY_TIP))).toBe(true);
  });

  it('builds escalate ladder with Ch1–Ch5 lines', () => {
    const status = detectSearchProviderEnvKeys({ BRAVE_API_KEY: 'x' } as NodeJS.ProcessEnv);
    const late = detectSearchLateChannelEnv({
      SUPERLIORA_CHROME_RESEARCH_BRIDGE: '1',
    } as NodeJS.ProcessEnv);
    const ladder = buildSearchEscalateLadderLines(status, late);
    expect(ladder.some((line) => line.includes('Ch1 Paid/API'))).toBe(true);
    expect(ladder.some((line) => line.includes('Ch2 Meta'))).toBe(true);
    expect(ladder.some((line) => line.includes('Ch3 Fetch'))).toBe(true);
    expect(ladder.some((line) => line.includes('Ch4 Browser'))).toBe(true);
    expect(ladder.some((line) => line.includes('Ch5 Chrome ext: ON'))).toBe(true);
  });

  it('shows Ch2 SearXNG ready in ladder when env is set', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    const late = detectSearchLateChannelEnv({
      SUPERLIORA_SEARXNG_URL: 'http://127.0.0.1:8080',
    } as NodeJS.ProcessEnv);
    const ladder = buildSearchEscalateLadderLines(status, late);
    expect(ladder.some((line) => line.includes('SearXNG ready'))).toBe(true);
    expect(ladder.some((line) => line.includes(SEARXNG_URL_ENV))).toBe(true);
  });
});

describe('research bridge Ch5 smoke handshake', () => {
  const savedManifest = process.env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST'];

  afterEach(() => {
    clearResearchBridgeSmokeCache();
    if (savedManifest === undefined) {
      delete process.env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST'];
    } else {
      process.env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST'] = savedManifest;
    }
  });

  it('promotes to smoke-verified when mocked smoke succeeds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-liora-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-liora-'));
    const scriptPath = join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs');
    mkdirSync(join(agentCoreRoot, 'scripts'), { recursive: true });
    writeFileSync(scriptPath, '// stub', 'utf8');

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;

    let spawnCalls = 0;
    const late = detectSearchLateChannelEnv(env, undefined, {
      agentCoreRoot,
      smokeDeps: {
        now: () => 1_000,
        spawnSync: () => {
          spawnCalls += 1;
          return mockSpawnOk('research-bridge-native-host smoke ok (0.1.0-stub)\n');
        },
      } as unknown as import('#/tui/commands/config/search/search-status').NativeHostSmokeDeps,
    });

    expect(spawnCalls).toBe(1);
    expect(late.nativeHandshake).toBe('smoke-verified');
    expect(late.nativeSmokeVersion).toBe('0.1.0-stub');
    expect(formatResearchBridgeHandshakeLine(late.nativeHandshake, late.nativeSmokeVersion ?? undefined)).toContain(
      'smoke verified',
    );
  });

  it('caches smoke probe within TTL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-liora-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-liora-'));
    mkdirSync(join(agentCoreRoot, 'scripts'), { recursive: true });
    writeFileSync(join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs'), '// stub', 'utf8');

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;

    let now = 5_000;
    let spawnCalls = 0;
    const smokeDeps = {
      now: () => now,
      spawnSync: () => {
        spawnCalls += 1;
        return mockSpawnOk('research-bridge-native-host smoke ok (cached)\n');
      },
    } as unknown as import('#/tui/commands/config/search/search-status').NativeHostSmokeDeps;

    detectSearchLateChannelEnv(env, undefined, { agentCoreRoot, smokeDeps });
    now += NATIVE_HOST_SMOKE_CACHE_TTL_MS - 1;
    detectSearchLateChannelEnv(env, undefined, { agentCoreRoot, smokeDeps });
    expect(spawnCalls).toBe(1);
  });

  it('surfaces Ch5 smoke-verified live line in Settings status', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-liora-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-liora-'));
    mkdirSync(join(agentCoreRoot, 'scripts'), { recursive: true });
    writeFileSync(join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs'), '// stub', 'utf8');

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;

    const late = detectSearchLateChannelEnv(env, undefined, {
      agentCoreRoot,
      smokeDeps: {
        spawnSync: () => mockSpawnOk('research-bridge-native-host smoke ok (0.1.0-stub)\n'),
      } as unknown as import('#/tui/commands/config/search/search-status').NativeHostSmokeDeps,
    });

    const status = detectSearchProviderEnvKeys(env);
    const lines = buildSearchSettingsStatusLines({
      status,
      late,
      cacheStatus: 'on-disk',
      freeFallback: true,
    });
    const text = lines.join('\n');
    expect(text).toContain('Ch5 bridge: smoke verified');
    expect(text).toContain('smoke verified (0.1.0-stub)');
    expect(text).toContain('Ch5 Chrome ext: ON');
  });

  it('surfaces Ch5 smoke-verified on Ops Runtime Health search suffix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-liora-ops-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-liora-ops-'));
    mkdirSync(join(agentCoreRoot, 'scripts'), { recursive: true });
    writeFileSync(join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs'), '// stub', 'utf8');

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;

    const late = detectSearchLateChannelEnv(env, undefined, {
      agentCoreRoot,
      smokeDeps: {
        spawnSync: () => mockSpawnOk('research-bridge-native-host smoke ok (0.1.0-stub)\n'),
      } as unknown as import('#/tui/commands/config/search/search-status').NativeHostSmokeDeps,
    });

    expect(late.nativeHandshake).toBe('smoke-verified');
    const suffix = formatSearchLateChannelOpsSuffix(late);
    expect(suffix).toContain('Ch5 smoke verified (0.1.0-stub)');
    expect(suffix).not.toContain('Ch5 chrome-ext ON');
  });

  it('probeNativeHostSmoke parses version from stdout', () => {
    const probe = probeNativeHostSmoke('/tmp/script.mjs', {} as NodeJS.ProcessEnv, {
      now: () => 42,
      spawnSync: () => mockSpawnOk('research-bridge-native-host smoke ok (9.9.9)\n'),
    } as unknown as import('#/tui/commands/config/search/search-status').NativeHostSmokeDeps);
    expect(probe.ok).toBe(true);
    expect(probe.version).toBe('9.9.9');
    expect(probe.probedAt).toBe(42);
  });
});

describe('buildSearchSettingsStatusLines', () => {
  it('surfaces never-empty telemetry line when provided', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    const lines = buildSearchSettingsStatusLines({
      status,
      late: detectSearchLateChannelEnv({} as NodeJS.ProcessEnv),
      cacheStatus: 'on-disk',
      freeFallback: true,
      neverEmptyTelemetryLine: 'hard-fail 0 · soft-degrade 2',
    });
    const text = lines.join('\n');
    expect(text).toContain('Never-empty: hard-fail 0 · soft-degrade 2');
    expect(text).not.toContain(SEARCH_NEVER_EMPTY_TELEMETRY_TIP);
  });

  it('surfaces live free-only KPI line and hides bench stub tip when provided', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    const lines = buildSearchSettingsStatusLines({
      status,
      late: detectSearchLateChannelEnv({} as NodeJS.ProcessEnv),
      cacheStatus: 'on-disk',
      freeFallback: true,
      freeOnlyKpiLine: 'soft 100% · hard-fail 0 · target ≥99%',
    });
    const text = lines.join('\n');
    expect(text).toContain('Free-only KPI: soft 100% · hard-fail 0 · target ≥99%');
    expect(text).not.toContain(SEARCH_FREE_ONLY_KPI_TIP);
  });

  it('shows never-empty telemetry stub tip when counters absent', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    const lines = buildSearchSettingsStatusLines({
      status,
      late: detectSearchLateChannelEnv({} as NodeJS.ProcessEnv),
      cacheStatus: 'on-disk',
      freeFallback: true,
    });
    expect(lines.join('\n')).toContain(SEARCH_NEVER_EMPTY_TELEMETRY_TIP);
    expect(lines.join('\n')).toContain(LOCAL_RESEARCH_CACHE_HIT_TIP);
  });

  it('surfaces LocalResearchCache hit line when provided', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    const lines = buildSearchSettingsStatusLines({
      status,
      late: detectSearchLateChannelEnv({} as NodeJS.ProcessEnv),
      cacheStatus: 'on-disk',
      freeFallback: true,
      localResearchCacheHitLine: 'hit 80% · 4/5 lookups',
    });
    const text = lines.join('\n');
    expect(text).toContain('LocalResearchCache: hit 80% · 4/5 lookups');
    expect(text).not.toContain(LOCAL_RESEARCH_CACHE_HIT_TIP);
  });

  it('surfaces free-fallback force path, Ch2 meta, and PreferXai env line', () => {
    const status = detectSearchProviderEnvKeys({ XAI_API_KEY: 'k' } as NodeJS.ProcessEnv);
    const lines = buildSearchSettingsStatusLines({
      status,
      late: detectSearchLateChannelEnv({} as NodeJS.ProcessEnv),
      cacheStatus: 'on-disk',
      freeFallback: true,
    });
    const text = lines.join('\n');
    expect(text).toContain(SEARCH_FREE_FALLBACK_FORCE_TIP);
    expect(text).toContain(SEARCH_FREE_ONLY_KPI_TIP);
    expect(text).toContain(SEARCH_META_CH2_TIP);
    expect(text).toContain(SEARCH_XAI_ENV_LINE);
    expect(text).toContain('PreferXai');
    expect(text).toContain('Ch2 Meta');
    expect(text).toContain(SEARXNG_URL_ENV);
  });

  it('shows Ch2 ready live line when SUPERLIORA_SEARXNG_URL is set', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    const lines = buildSearchSettingsStatusLines({
      status,
      late: detectSearchLateChannelEnv({
        SUPERLIORA_SEARXNG_URL: 'http://127.0.0.1:8080',
      } as NodeJS.ProcessEnv),
      cacheStatus: 'on-disk',
      freeFallback: true,
    });
    const text = lines.join('\n');
    expect(text).toContain('Ch2 Meta: SearXNG ready (http://127.0.0.1:8080)');
    expect(text).toContain('Ready: http://127.0.0.1:8080');
  });

  it('surfaces live cascade channelsTried in Session (live) from AppState', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    const nowMs = 5_000;
    const lines = buildSearchSettingsStatusLines({
      status,
      late: detectSearchLateChannelEnv({} as NodeJS.ProcessEnv),
      cacheStatus: 'on-disk',
      freeFallback: true,
      searchCascade: { channelsTried: ['ch1', 'ch4'], atMs: nowMs },
      nowMs,
    });
    const text = lines.join('\n');
    expect(text).toContain('── Session (live) ──');
    expect(text).toContain('Cascade: ch1→ch4');
    expect(text).not.toContain(
      'Cascade: both tools emit channelsTried on degrade → footer research↻ + /ops Cascade line (~30s).',
    );
  });

  it('shows cascade stub in Session (live) when AppState unwired', () => {
    const status = detectSearchProviderEnvKeys({} as NodeJS.ProcessEnv);
    const lines = buildSearchSettingsStatusLines({
      status,
      late: detectSearchLateChannelEnv({} as NodeJS.ProcessEnv),
      cacheStatus: 'on-disk',
      freeFallback: true,
      searchCascade: null,
    });
    const text = lines.join('\n');
    expect(text).toContain('── Session (live) ──');
    expect(text).toContain('Cascade channelsTried: live after WebSearch/DeepResearch degrade');
    expect(text).toContain(
      'Cascade: both tools emit channelsTried on degrade → footer research↻ + /ops Cascade line (~30s).',
    );
  });
});

describe('search freeFallback config path', () => {
  const envKey = 'SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK';

  afterEach(() => {
    delete process.env[envKey];
  });

  it('defaults to on unless explicitly false with advanced override', () => {
    expect(resolveSearchFreeFallback(undefined)).toBe(true);
    expect(resolveSearchFreeFallback({})).toBe(true);
    expect(resolveSearchFreeFallback({ research: { search: { freeFallback: true } } })).toBe(true);
    expect(resolveSearchFreeFallback({ research: { search: { freeFallback: false } } })).toBe(true);
    process.env[envKey] = '1';
    expect(resolveSearchFreeFallback({ research: { search: { freeFallback: false } } })).toBe(
      false,
    );
  });

  it('builds harness.setConfig patch at research.search.freeFallback', () => {
    expect(buildSearchFreeFallbackConfigPatch(true)).toEqual({
      research: { search: { freeFallback: true } },
    });
    expect(buildSearchFreeFallbackConfigPatch(false)).toEqual({
      research: { search: { freeFallback: false } },
    });
  });
});

describe('resolveLocalResearchCacheStatus', () => {
  it('returns on-disk when localSearch is default or enabled', () => {
    expect(resolveLocalResearchCacheStatus({})).toBe('on-disk');
    expect(resolveLocalResearchCacheStatus({ research: { localSearch: { enabled: true } } })).toBe(
      'on-disk',
    );
    expect(formatLocalResearchCacheLine('on-disk')).toBe('Local cache: on (disk)');
  });

  it('returns off when localSearch.enabled is false', () => {
    expect(
      resolveLocalResearchCacheStatus({ research: { localSearch: { enabled: false } } }),
    ).toBe('off');
    expect(formatLocalResearchCacheLine('off')).toBe('Local cache: off');
  });

  it('returns unknown when config is unavailable', () => {
    expect(resolveLocalResearchCacheStatus(undefined)).toBe('unknown');
    expect(formatLocalResearchCacheLine('unknown')).toBe('Local cache: unknown');
  });
});
