/** Combined settings-glance copy locks. Nested describe per former file. */
import {
  describe,
  expect,
  it,
  afterEach,
  vi,
  beforeEach,
} from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { darkColors, lightColors } from '#/tui/theme';
import {
  buildAppearanceSettingsLines,
  formatLiveThemeLine,
  loadAppearanceSettingsGlance,
  resolveLivePaletteKind,
} from '#/tui/utils/appearance/appearance-glance';


import {
  CACHE_INVALIDATE_TIP,
  buildCacheSettingsLines,
  cacheInvalidateStatusMessage,
  nextCacheInvalidateEpoch,
  resolveCacheHitFromAppState,
  resolveCacheHitSources,
  resolveCacheSessionGlance,
} from '#/tui/utils/cache/cache-glance';
import {
  KEYMAP_ALL,
  KEYMAP_ALWAYS,
  KEYMAP_IDLE,
  KEYMAP_STREAMING,
  formatKeymapBindingSample,
  keymapBindingsForSlash,
  keymapSurfaceCounts,
} from '#/tui/keymap';
import { buildKeybindingsSettingsLines, loadKeybindingsGlance } from '#/tui/utils/keymap/keybindings-glance';



import { buildNetworkSettingsLines, loadNetworkGlance } from '#/tui/utils/network/network-glance';
import { formatOpsTokenGlance } from '#/tui/utils/usage/ops-token-glance';
import {
  buildProvidersApiSettingsLines,
  formatActiveModelLine,
  formatActiveProviderLine,
  loadProvidersApiGlance,
  resolveProvidersApiSessionGlance,
} from '#/tui/utils/provider/providers-api-glance';

import { formatOpsRouteLine } from '#/tui/utils/model/route-glance';
import {
  buildSecuritySettingsLines,
  formatNetworkEgressLines,
  formatPermissionModeLine,
  formatSandboxEnforcementLine,
  formatSandboxProfileLine,
  formatWorkspaceSandboxLines,
  SECURITY_NOT_OS_SANDBOX,
  SECURITY_REDACTION_TIP,
  SECURITY_SANDBOX_TIP,
  securityNavigationLines,
  securitySecretRedactionLines,
} from '#/tui/utils/security/security-glance';

import {
  getTelemetryRuntimeGlance,
  initializeTelemetry,
  resetDefaultTelemetryClientForTests,
  shutdownTelemetry,
  TELEMETRY_ENDPOINT,
} from '@superliora/telemetry';
import {
  buildTelemetryConfigPatch,
  buildTelemetrySettingsLines,
  isTelemetryDisabledByEnv,
  loadTelemetryGlance,
} from '#/tui/utils/telemetry/telemetry-glance';
import {
  buildThemeSettingsLines,
  formatThemeCatalogLine,
  loadThemeSettingsGlance,
  resolveLivePaletteKind as resolveThemeLivePaletteKind,
} from '#/tui/utils/theme/theme-glance';


describe('appearance-glance', () => {
  describe('appearance theme glance', () => {
    it('resolves live palette kind from theme engine singleton', () => {
      expect(resolveLivePaletteKind(lightColors)).toBe('light');
      expect(resolveLivePaletteKind(darkColors)).toBe('dark');
      expect(resolveLivePaletteKind({ ...darkColors, background: '#010203' })).toBe('custom');
    });

    it('formats auto theme with terminal-tracked live palette', () => {
      const line = formatLiveThemeLine(
        loadAppearanceSettingsGlance({
          savedTheme: 'auto',
          palette: lightColors,
          canvasBackgroundEnabled: true,
        }),
      );
      expect(line).toBe('Theme: auto · live palette light (tracking terminal)');
    });

    it('formats custom saved theme with live custom palette', () => {
      const line = formatLiveThemeLine(
        loadAppearanceSettingsGlance({
          savedTheme: 'superliora-ash',
          palette: { ...darkColors, background: '#010203' },
          canvasBackgroundEnabled: false,
        }),
      );
      expect(line).toBe('Theme: superliora-ash · live palette custom');
    });

    it('builds settings panel with live session block', () => {
      const text = buildAppearanceSettingsLines(
        loadAppearanceSettingsGlance({
          savedTheme: 'dark',
          palette: darkColors,
          canvasBackgroundEnabled: true,
          appearance: {
            ...DEFAULT_APPEARANCE_PREFERENCES,
            profile: 'premium',
            density: 'compact',
          },
        }),
      ).join('\n');
      expect(text).toContain('── Session (live) ─');
      expect(text).toContain('Theme: dark · live palette dark');
      expect(text).toContain('profile premium');
      expect(text).toContain('canvas on');
    });
  });
});


describe('cache-glance', () => {
  describe('cache invalidate epoch helpers', () => {
    it('mentions Settings invalidate in the tip', () => {
      expect(CACHE_INVALIDATE_TIP).toContain('Settings → Cache');
    });

    it('bumps epoch from zero or undefined', () => {
      expect(nextCacheInvalidateEpoch(undefined)).toBe(1);
      expect(nextCacheInvalidateEpoch(0)).toBe(1);
      expect(nextCacheInvalidateEpoch(2)).toBe(3);
    });

    it('formats status message with epoch when provided', () => {
      expect(cacheInvalidateStatusMessage(2)).toContain('epoch v2');
      expect(cacheInvalidateStatusMessage()).toBe(CACHE_INVALIDATE_TIP);
    });
  });

  describe('resolveCacheHitFromAppState', () => {
    it('returns rate and streak when cacheMeter is populated', () => {
      expect(resolveCacheHitFromAppState({ rate: 0.995, streak: 4 })).toEqual({
        rate: 0.995,
        streak: 4,
      });
    });

    it('returns undefined for null, missing, or non-finite rate', () => {
      expect(resolveCacheHitFromAppState(null)).toBeUndefined();
      expect(resolveCacheHitFromAppState(undefined)).toBeUndefined();
      expect(resolveCacheHitFromAppState({ rate: Number.NaN, streak: 0 })).toBeUndefined();
    });
  });

  describe('resolveCacheHitSources', () => {
    it('prefers live status hit rate and streak over AppState', () => {
      const meter = resolveCacheHitSources({
        appStateCacheMeter: { rate: 0.5, streak: 1 },
        statusHitRate: 0.995,
        statusWarmStreak: 7,
      });
      expect(meter.line).toContain('100%');
      expect(meter.line).toContain('streak×7');
      expect(meter.meetsTarget).toBe(true);
    });

    it('falls back to AppState cacheMeter when status has no hit rate', () => {
      const meter = resolveCacheHitSources({
        appStateCacheMeter: { rate: 0.995, streak: 3 },
      });
      expect(meter.line).toContain('100%');
      expect(meter.line).toContain('streak×3');
    });

    it('returns no-data line when neither source is available', () => {
      expect(resolveCacheHitSources({}).line).toBe('Cache hit: (no data yet)');
    });
  });

  describe('resolveCacheSessionGlance', () => {
    it('builds live session lines from getStatus hit rate, streak, and freeze', () => {
      const glance = resolveCacheSessionGlance({
        statusHitRate: 0.995,
        statusWarmStreak: 4,
        cacheFrozen: true,
        usage: {
          cacheDiagnostics: { toolBlockChanged: false, toolBlockHash: 'abc', messageCount: 3 },
        },
      });
      expect(glance.hitLine).toContain('streak×4');
      expect(glance.statusLine.text).toContain('Status: warm');
      expect(glance.freezeLine?.text).toBe('Freeze: active (mid-turn · step soft-check on)');
      expect(glance.prefixLine?.text).toBe('Prefix: stable');
    });

    it('buildCacheSettingsLines puts session live block before tips', () => {
      const glance = resolveCacheSessionGlance({
        statusHitRate: 0.5,
        statusWarmStreak: 0,
        cacheFrozen: false,
      });
      const lines = buildCacheSettingsLines(glance);
      const liveIdx = lines.findIndex((line) => line.includes('Session (live)'));
      const tipsIdx = lines.findIndex((line) => line.includes('Cache Sacred rules'));
      expect(liveIdx).toBeGreaterThan(-1);
      expect(tipsIdx).toBeGreaterThan(liveIdx);
      expect(lines.some((line) => line.includes('Session cache hit:'))).toBe(true);
      expect(lines.some((line) => line.includes('Invalidate:'))).toBe(true);
      expect(lines.some((line) => line.includes('Freeze policy:'))).toBe(true);
      expect(lines.some((line) => line.includes('Cache miss dump export'))).toBe(true);
      expect(lines.some((line) => line.includes('superliora.cache_miss.v1'))).toBe(true);
    });

    it('buildCacheSettingsLines embeds usage histogram in miss dump export', () => {
      const session = resolveCacheSessionGlance({
        statusHitRate: 0.88,
        statusWarmStreak: 3,
        cacheFrozen: true,
      });
      const text = buildCacheSettingsLines({
        session,
        usage: {
          cacheDiagnostics: {
            toolBlockChanged: true,
            missReasons: { schema_change: 2, prefix_drift: 1 },
          },
        },
        cacheHitRate: 0.88,
        cacheWarmStreak: 3,
        cacheFrozen: true,
        capturedAtIso: '2026-08-02T06:00:00.000Z',
      }).join('\n');
      expect(text).toContain('Tool block: changed (prefix risk)');
      expect(text).toContain('schema_change×2');
      expect(text).toContain('Hit rate: 88.0%');
      expect(text).toContain('Warm streak: 3');
      expect(text).toContain('Frozen: yes');
      expect(text).toContain('"schema": "superliora.cache_miss.v1"');
    });
  });
});


describe('keybindings-glance', () => {
  describe('keymap registry', () => {
    it('counts bindings per surface', () => {
      const counts = keymapSurfaceCounts();
      expect(counts.total).toBe(KEYMAP_ALL.length);
      expect(counts.always).toBe(KEYMAP_ALWAYS.length);
      expect(counts.idle).toBe(KEYMAP_IDLE.length);
      expect(counts.streaming).toBe(KEYMAP_STREAMING.length);
    });

    it('tags native Job controls in slash samples', () => {
      expect(keymapBindingsForSlash('/jobs dock').map((b) => b.id)).toEqual([
        'interrupt',
        'steer',
        'background',
      ]);
      expect(keymapBindingsForSlash('/jobs').map((b) => b.id)).toEqual([
        'job-deck',
        'background',
      ]);
      expect(keymapBindingsForSlash('/quota').map((b) => b.id)).toEqual(['quota']);
      expect(keymapBindingsForSlash('/mission')).toEqual([]);
      expect(formatKeymapBindingSample(keymapBindingsForSlash('/jobs dock')[0]!)).toContain(
        process.platform === 'darwin' ? 'Cmd-C' : 'Ctrl-C',
      );
    });
  });

  describe('keybindings-glance', () => {
    it('references keymap SSOT and /help', () => {
      const glance = loadKeybindingsGlance();
      expect(glance.bindingCount).toBe(KEYMAP_ALL.length);
      expect(glance.alwaysCount).toBe(KEYMAP_ALWAYS.length);
      expect(glance.idleCount).toBe(KEYMAP_IDLE.length);
      expect(glance.streamingCount).toBe(KEYMAP_STREAMING.length);

      const lines = buildKeybindingsSettingsLines(glance).join('\n');
      expect(lines).toContain('Keyboard / Keybindings (read-only)');
      expect(lines).toContain('Live registry (keymap.ts)');
      expect(lines).toContain('/help');
      expect(lines).toContain(String(KEYMAP_ALL.length));
      expect(lines).toContain(
        `${process.platform === 'darwin' ? 'Cmd-C' : 'Ctrl-C'} — Stop the current turn`,
      );
      expect(lines).toContain(
        `${process.platform === 'darwin' ? 'Cmd-O' : 'Ctrl-O'} — Cycle transcript density`,
      );
      expect(lines).toContain(
        `${process.platform === 'darwin' ? 'Cmd-B' : 'Ctrl-B'} — Background the current work`,
      );
      expect(lines).toContain('No keybinding editor here');
    });
  });
});



describe('network-glance', () => {
  describe('network-glance', () => {
    it('reads HTTP_PROXY, HTTPS_PROXY, and NO_PROXY from process env', () => {
      const glance = loadNetworkGlance({
        HTTP_PROXY: 'http://proxy.example.test:8080',
        HTTPS_PROXY: 'http://secure.example.test:8443',
        NO_PROXY: 'localhost,127.0.0.1',
      } as NodeJS.ProcessEnv);

      expect(glance.httpProxy).toBe('http://proxy.example.test:8080');
      expect(glance.httpsProxy).toBe('http://secure.example.test:8443');
      expect(glance.noProxy).toBe('localhost,127.0.0.1');
      expect(glance.proxyActive).toBe(true);

      const lines = buildNetworkSettingsLines(glance).join('\n');
      expect(lines).toContain('Process env (live)');
      expect(lines).toContain('HTTP_PROXY=http://proxy.example.test:8080');
      expect(lines).toContain('HTTPS_PROXY=http://secure.example.test:8443');
      expect(lines).toContain('NO_PROXY=localhost,127.0.0.1');
      expect(lines).toContain('ACTIVE');
    });

    it('accepts lowercase env var names', () => {
      const glance = loadNetworkGlance({
        http_proxy: 'http://lower.example.test:3128',
        no_proxy: '*.internal',
      } as NodeJS.ProcessEnv);

      expect(glance.httpProxy).toBe('http://lower.example.test:3128');
      expect(glance.noProxy).toBe('*.internal');
    });

    it('reports direct posture when no proxy env is set', () => {
      const glance = loadNetworkGlance({} as NodeJS.ProcessEnv);
      const lines = buildNetworkSettingsLines(glance).join('\n');

      expect(glance.proxyActive).toBe(false);
      expect(lines).toContain('not configured');
      expect(lines).toContain('HTTP_PROXY: unset');
      expect(lines).toContain('HTTPS_PROXY: unset');
      expect(lines).toContain('NO_PROXY: unset');
    });

    it('detects SOCKS via ALL_PROXY', () => {
      const glance = loadNetworkGlance({
        ALL_PROXY: 'socks5h://127.0.0.1:1080',
      } as NodeJS.ProcessEnv);

      expect(glance.socksConfigured).toBe(true);
      expect(glance.proxyActive).toBe(true);
      expect(buildNetworkSettingsLines(glance).join('\n')).toContain('SOCKS proxy detected');
    });
  });
});

describe('ops-token-glance', () => {
  describe('formatOpsTokenGlance', () => {
    it('returns no-data when usage is missing', () => {
      expect(formatOpsTokenGlance({})).toBe('Tokens: (no data yet)');
    });

    it('formats totals from usage.total with cache hit and cost', () => {
      expect(
        formatOpsTokenGlance({
          usage: {
            total: {
              inputOther: 10_000,
              inputCacheRead: 2_300,
              inputCacheCreation: 0,
              output: 1_200,
            },
          },
          cacheHitRate: 0.99,
          costUsd: 0.42,
        }),
      ).toBe('Tokens: in 12.3K · out 1.2K · cache 99% · $0.420');
    });

    it('aggregates byModel when total is absent', () => {
      expect(
        formatOpsTokenGlance({
          usage: {
            byModel: {
              'gpt-test': { inputOther: 500, output: 50, inputCacheRead: 0, inputCacheCreation: 0 },
              'gpt-mini': { inputOther: 500, output: 50, inputCacheRead: 0, inputCacheCreation: 0 },
            },
          },
          cacheHitRate: 0.5,
        }),
      ).toBe('Tokens: in 1.0K · out 100 · cache 50%');
    });

    it('omits cache and cost when unavailable', () => {
      expect(
        formatOpsTokenGlance({
          usage: {
            total: { inputOther: 100, output: 20, inputCacheRead: 0, inputCacheCreation: 0 },
          },
        }),
      ).toBe('Tokens: in 100 · out 20');
    });

    it('shows budget cap and remaining when runtime budget env is set', () => {
      expect(
        formatOpsTokenGlance({
          usage: {
            total: { inputOther: 100, output: 20, inputCacheRead: 0, inputCacheCreation: 0 },
          },
          costUsd: 0.42,
          budgetUsd: 5,
        }),
      ).toBe('Tokens: in 100 · out 20 · $0.420 · budget $5.00 · $4.58 left');
    });

    it('shows over-budget when spend exceeds cap', () => {
      expect(
        formatOpsTokenGlance({
          usage: {
            total: { inputOther: 100, output: 20, inputCacheRead: 0, inputCacheCreation: 0 },
          },
          costUsd: 6.5,
          budgetUsd: 5,
        }),
      ).toBe('Tokens: in 100 · out 20 · $6.50 · budget $5.00 · over $1.50');
    });

    it('shows budget cap alone when spend is not tracked yet', () => {
      expect(
        formatOpsTokenGlance({
          usage: {
            total: { inputOther: 100, output: 20, inputCacheRead: 0, inputCacheCreation: 0 },
          },
          budgetUsd: 5,
        }),
      ).toBe('Tokens: in 100 · out 20 · budget $5.00');
    });
  });
});


describe('providers-api-glance', () => {
  describe('providers-api-glance', () => {
    it('detects configured provider env keys without echoing values', () => {
      const glance = loadProvidersApiGlance({
        ANTHROPIC_API_KEY: 'secret',
        OPENAI_API_KEY: 'secret',
      } as NodeJS.ProcessEnv);

      expect(glance.configuredLabels).toEqual(['Anthropic', 'OpenAI']);
      const lines = buildProvidersApiSettingsLines(glance).join('\n');
      expect(lines).toContain('Providers & API (read-only)');
      expect(lines).toContain('Anthropic, OpenAI');
      expect(lines).not.toContain('secret');
      expect(lines).toContain('/login');
      expect(lines).toContain('KIMI_API_KEY');
    });

    it('reports empty env posture', () => {
      const glance = loadProvidersApiGlance({} as NodeJS.ProcessEnv);
      const lines = buildProvidersApiSettingsLines(glance).join('\n');
      expect(lines).toContain('No common provider API keys detected');
      expect(lines).toContain('No key editor here');
    });

    it('includes live session section with active provider/model from status', () => {
      const session = resolveProvidersApiSessionGlance({
        statusModel: 'kimi-k2',
        availableModels: {
          'kimi-k2': {
            displayName: 'Kimi K2',
            model: 'kimi-k2-upstream',
            provider: 'moonshot',
            maxContextSize: 256_000,
          },
        },
        providerRouteStatus: { primary: true } as never,
        catalogModels: 12,
        catalogProviders: 3,
      });

      expect(formatActiveModelLine(session)).toContain('Kimi K2 (kimi-k2)');
      expect(formatActiveModelLine(session)).toContain('live session confirms');
      expect(formatActiveProviderLine(session)).toBe(
        'Active provider: moonshot · upstream kimi-k2-upstream',
      );

      const lines = buildProvidersApiSettingsLines({
        configuredLabels: ['Anthropic'],
        registryKeySet: false,
        providerKeySet: false,
        session,
      }).join('\n');

      expect(lines).toContain('── Session (live) ─');
      expect(lines).toContain('Active model: Kimi K2 (kimi-k2) · live session confirms');
      expect(lines).toContain('Active provider: moonshot · upstream kimi-k2-upstream');
      expect(lines).toContain('Catalog: 12 models / 3 providers');
      expect(lines).toContain('Route: primary');
    });

    it('reports session unavailable without live session confirms', () => {
      const session = resolveProvidersApiSessionGlance({
        sessionUnavailable: true,
        catalogModels: 0,
        catalogProviders: 0,
      });
      const lines = buildProvidersApiSettingsLines({
        configuredLabels: [],
        registryKeySet: false,
        providerKeySet: false,
        session,
      }).join('\n');

      expect(lines).toContain('no active session');
      expect(lines).not.toContain('live session confirms');
    });
  });
});

describe('route-glance', () => {
  describe('route-glance', () => {
    it('returns null when no route data exists', () => {
      expect(formatOpsRouteLine({})).toBeNull();
      expect(
        formatOpsRouteLine({
          providerRouteStatus: null,
          lastModelRouteNotice: null,
        }),
      ).toBeNull();
    });

    it('shows primary when providerRouteStatus is present', () => {
      expect(
        formatOpsRouteLine({
          providerRouteStatus: {
            modelAlias: 'gpt-test',
            strategy: 'fallback',
            candidates: [],
          },
        }),
      ).toBe('Route: primary');
    });

    it('shows failover line from lastModelRouteNotice', () => {
      expect(
        formatOpsRouteLine({
          providerRouteStatus: {
            modelAlias: 'gpt-test',
            strategy: 'fallback',
            candidates: [],
          },
          lastModelRouteNotice: {
            kind: 'failover',
            fromAlias: 'gpt-test',
            toAlias: 'cheap-model',
            reason: 'provider-failover',
            atMs: Date.now(),
          },
          availableModels: {
            'cheap-model': { model: 'cheap-model', displayName: 'Cheap Model', provider: 'mock', maxContextSize: 128_000 },
          },
        }),
      ).toBe('Route: failover→Cheap Model (provider-failover)');
    });

    it('omits reason parens when reason is empty', () => {
      expect(
        formatOpsRouteLine({
          lastModelRouteNotice: {
            kind: 'failover',
            toAlias: 'backup',
            atMs: Date.now(),
          },
        }),
      ).toBe('Route: failover→backup');
    });

    it('ignores non-failover notices without providerRouteStatus', () => {
      expect(
        formatOpsRouteLine({
          lastModelRouteNotice: {
            kind: 'selection',
            toAlias: 'gpt-test',
            reason: 'provider-credential',
            atMs: Date.now(),
          },
        }),
      ).toBeNull();
    });

    it('prefers failover over primary when both are present', () => {
      expect(
        formatOpsRouteLine({
          providerRouteStatus: {
            modelAlias: 'gpt-test',
            strategy: 'auto',
            candidates: [],
          },
          lastModelRouteNotice: {
            kind: 'failover',
            toAlias: 'fallback',
            reason: 'rate_limit',
            atMs: Date.now(),
          },
        }),
      ).toBe('Route: failover→fallback (rate_limit)');
    });
  });
});

describe('security-glance', () => {
  describe('security-glance', () => {
    it('formats permission mode with session mismatch', () => {
      expect(formatPermissionModeLine('auto', 'manual')).toContain('TUI');
      expect(formatPermissionModeLine('auto', 'manual')).toContain('session reports manual');
    });

    it('formats permission mode with live session confirmation', () => {
      expect(formatPermissionModeLine('auto', 'auto')).toContain('live session confirms');
      expect(formatPermissionModeLine('yolo')).toContain('/permission');
    });

    it('lists workspace root, sandbox profile, extra dirs, and honest OS disclaimer', () => {
      const lines = formatWorkspaceSandboxLines('/tmp/project', ['/tmp/extra'], 'read-only');
      expect(lines.some((l) => l.includes('Workspace root: /tmp/project'))).toBe(true);
      expect(lines.some((l) => l.includes('Sandbox profile: read-only'))).toBe(true);
      expect(lines.some((l) => l.includes('/add-dir'))).toBe(true);
      expect(lines.some((l) => l.includes('Not an OS sandbox'))).toBe(true);
      expect(formatSandboxProfileLine('workspace')).toMatch(/Lexical Bash path tokens outside workspace roots/);
      expect(formatSandboxProfileLine('workspace')).toMatch(/not execution isolation/);
      expect(formatSandboxProfileLine(undefined)).toContain('off');
      expect(formatSandboxEnforcementLine('process')).toContain('Native Bash execution requires Docker');
      expect(formatSandboxEnforcementLine('process')).toContain('No host fallback');
      expect(formatSandboxEnforcementLine('process')).not.toMatch(/Job Object|degrades to lexical/);
      expect(formatSandboxEnforcementLine('process', 'Docker Desktop not found')).toContain(
        'Docker Desktop not found',
      );
      expect(lines.some((l) => l.includes('Sandbox enforcement: lexical'))).toBe(true);
    });

    it('summarizes network egress from process env', () => {
      const direct = formatNetworkEgressLines(loadNetworkGlance({}));
      expect(direct[0]).toContain('direct');
      const proxied = formatNetworkEgressLines(
        loadNetworkGlance({ HTTPS_PROXY: 'http://proxy.example.test:8080' }),
      );
      expect(proxied[0]).toContain('proxy ACTIVE');
      expect(proxied.some((l) => l.includes('HTTPS_PROXY='))).toBe(true);
    });

    it('exports compact sandbox and redaction tips without OS-sandbox claims', () => {
      expect(SECURITY_SANDBOX_TIP).toContain('not OS isolation');
      expect(SECURITY_SANDBOX_TIP).toContain('--sandbox');
      expect(SECURITY_SANDBOX_TIP).toContain('read-only');
      expect(SECURITY_SANDBOX_TIP).toContain('native Bash execution only');
      expect(SECURITY_SANDBOX_TIP).toContain('Docker required, no host fallback');
      expect(SECURITY_SANDBOX_TIP).toContain('not a whole-filesystem or all-tool sandbox');
      expect(SECURITY_NOT_OS_SANDBOX).toContain('Not an OS sandbox');
      expect(SECURITY_REDACTION_TIP).toContain('redactSecretsInText');
    });

    it('builds full security panel lines with live permission, sandbox, and network', () => {
      const lines = buildSecuritySettingsLines({
        permissionMode: 'auto',
        permissionFromSession: 'auto',
        sandboxProfile: 'workspace',
        sandboxEnforcement: 'process',
        processSandboxWarning: 'Docker unavailable — native Bash execution blocked.',
        workDir: '/workspace/demo',
        additionalDirs: [],
        network: loadNetworkGlance({}),
      });
      const text = lines.join('\n');
      expect(text).toContain('§9.2');
      expect(text).toContain('live session confirms');
      expect(text).toContain('Sandbox profile: workspace');
      expect(text).toContain('Sandbox enforcement: process');
      expect(text).toContain('native Bash execution blocked');
      expect(text).toContain('Host application, plugins, and raw Kaos remain trusted');
      expect(text).not.toContain('Job Object');
      expect(text).toContain('Not an OS sandbox');
      expect(text).toContain('Network egress');
      expect(text).toContain('/workspace/demo');
      expect(text).toContain('Settings → Network / Proxy');
      expect(text).toContain('redactSecretsInText');
      expect(text).toContain('redactSecretsInText before transcript');
      for (const tip of securitySecretRedactionLines()) {
        expect(lines).toContain(tip);
      }
      for (const hint of securityNavigationLines()) {
        expect(lines).toContain(hint);
      }
    });
  });
});


describe('telemetry-glance', () => {
  describe('telemetry-glance', () => {
    it('builds harness.setConfig patch for telemetry boolean', () => {
      expect(buildTelemetryConfigPatch(true)).toEqual({ telemetry: true });
      expect(buildTelemetryConfigPatch(false)).toEqual({ telemetry: false });
    });

    it('shows OFF as ZDR-friendly default', () => {
      const lines = buildTelemetrySettingsLines(
        loadTelemetryGlance({
          configEnabled: false,
          configPath: '/home/.superliora/config.toml',
        }),
      );
      expect(lines.join('\n')).toContain('Config opt-in: OFF');
      expect(lines.join('\n')).toContain('Live sink: OFF');
      expect(lines.join('\n')).toContain('ZDR-friendly');
      expect(lines.join('\n')).toContain('Settings → Telemetry ON/OFF');
    });

    it('shows config ON with live sink when runtime is attached', async () => {
      resetDefaultTelemetryClientForTests();
      const homeDir = await import('node:fs/promises').then((fs) =>
        fs.mkdtemp('/tmp/superliora-telemetry-glance-'),
      );
      initializeTelemetry({
        homeDir,
        deviceId: 'dev-test',
        enabled: true,
        appName: 'liora-cli',
        version: '0.0.0-test',
      });

      const glance = loadTelemetryGlance({
        configEnabled: true,
        configPath: '/tmp/config.toml',
      });
      expect(glance.liveEnabled).toBe(true);
      expect(glance.endpoint).toBe(TELEMETRY_ENDPOINT);

      const lines = buildTelemetrySettingsLines(glance);
      expect(lines.join('\n')).toContain('Config opt-in: ON');
      expect(lines.join('\n')).toContain('Live sink: ON');
      expect(lines.join('\n')).toContain(`Endpoint (live): ${TELEMETRY_ENDPOINT}`);
      expect(lines.join('\n')).toContain('/tmp/config.toml');

      await shutdownTelemetry();
      resetDefaultTelemetryClientForTests();
    });

    it('notes env disable override and effective forced OFF', () => {
      const lines = buildTelemetrySettingsLines(
        loadTelemetryGlance({
          configEnabled: true,
          configPath: '/tmp/config.toml',
          env: { KIMI_DISABLE_TELEMETRY: '1' },
        }),
      );
      expect(lines.join('\n')).toContain('KIMI_DISABLE_TELEMETRY=1');
      expect(lines.join('\n')).toContain('Effective: forced OFF');
    });

    it('shows SUPERLIORA_TELEMETRY opt-in marker when set', () => {
      const lines = buildTelemetrySettingsLines(
        loadTelemetryGlance({
          configEnabled: false,
          configPath: '/tmp/config.toml',
          env: { SUPERLIORA_TELEMETRY: '1' },
        }),
      );
      expect(lines.join('\n')).toContain('SUPERLIORA_TELEMETRY set');
    });

    it('detects KIMI_DISABLE_TELEMETRY truthy values', () => {
      expect(isTelemetryDisabledByEnv({ KIMI_DISABLE_TELEMETRY: '1' })).toBe(true);
      expect(isTelemetryDisabledByEnv({ KIMI_DISABLE_TELEMETRY: 'yes' })).toBe(true);
      expect(isTelemetryDisabledByEnv({})).toBe(false);
    });

    it('reports no live sink before initializeTelemetry', () => {
      resetDefaultTelemetryClientForTests();
      expect(getTelemetryRuntimeGlance()).toEqual({ liveEnabled: false });
    });
  });
});

describe('theme-glance', () => {
  describe('theme glance', () => {
    it('resolves live palette kind', () => {
      expect(resolveThemeLivePaletteKind(lightColors)).toBe('light');
      expect(resolveThemeLivePaletteKind(darkColors)).toBe('dark');
    });

    it('formats catalog counts', () => {
      const line = formatThemeCatalogLine({
        totalListed: 11,
        bundled: 4,
        custom: 2,
        bundledExternal: 5,
      });
      expect(line).toContain('11 listed');
      expect(line).toContain('4 bundled');
    });

    it('builds tip-heavy panel with live session block', () => {
      const text = buildThemeSettingsLines(
        loadThemeSettingsGlance({
          savedTheme: 'auto',
          palette: lightColors,
          canvasBackgroundEnabled: true,
          configPath: '/home/.superliora/tui.toml',
        }),
      ).join('\n');
      expect(text).toContain('── Session (live) ─');
      expect(text).toContain('Theme: auto · live palette light (tracking terminal)');
      expect(text).toContain('Catalog:');
      expect(text).toContain('/theme import');
      expect(text).toContain('Settings → Appearance');
    });
  });
});

