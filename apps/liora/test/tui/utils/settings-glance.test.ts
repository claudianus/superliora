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
import { SUPERLIORA_PROVIDER_NAME } from '@superliora/oauth';
import {
  ACCOUNTS_POOL_RESILIENCE_HINT,
  buildNeverHaltOAuthResilienceLines,
  formatOpsAuthLine,
  formatOpsAuthLineFromSessionStatus,
  formatOpsPermissionLine,
  formatOAuthProactivePollLabel,
  OPS_AUTH_OK_ACCOUNTS_TIP,
  OPS_AUTH_OK_SECRETS_TIP,
  oauthAccountsResilienceTips,
  resolveOAuthPoolGlance,
  resolveOAuthPoolGlanceFromConfig,
  resolveOAuthPoolGlanceFromStatus,
} from '#/tui/utils/never-halt/auth-glance';
import {
  resolveBreakerFromAppState,
  resolveBreakerStatus,
  resolveNeverHaltBreakerLines,
  resolveOpsBreakerLine,
  resolveOpsBreakerLineFromAppState,
} from '#/tui/utils/never-halt/breaker-glance';
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
  buildCompactionSettingsLines,
  COMPACTION_KEEP_TOKENS_TIP,
  COMPACTION_THRESHOLD_TIP,
  formatContextArchiveLine,
  formatLastCompactLine,
  resolveLastCompactionFromTranscript,
} from '#/tui/utils/compaction/compaction-glance';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildContextSettingsLines,
  discoverInstructionFiles,
  formatInstructionFilesLine,
  formatLearningMemoryLine,
} from '#/tui/utils/agent/context-glance';
import { buildExtensionsSessionLiveLines, buildExtensionsSettingsLines } from '#/tui/utils/agent/extensions-glance';
import { browserEyeFromSetupResult, computerEyeFromCuaStatus } from '#/tui/utils/harness-eyes-readiness';
import { buildEyesSettingsLines, loadEyesSettingsGlance } from '#/tui/utils/eyes/eyes-glance';
import {
  VERIFICATION_SENSOR_GOAL_DONE_TIP,
  REPO_INDEX_ENGINE_ENV,
  REPO_INDEX_FTS_BACKEND_TIP,
  REPO_INDEX_PREFERRED_ENGINE_TIP,
  REPO_INDEX_WARM_ENV,
  formatRepoIndexWiredLine,
  getRepoIndexStatus,
  repoIndexPreferredEngineTipLine,
  repoIndexWarmStatusLine,
} from '@superliora/sdk';
import {
  formatGoalSoftAdvisoryOpsDisplayLine,
  goalSoftAdvisoryPatchFromToolResult,
  resetGoalSoftAdvisoryLedger,
} from '#/tui/utils/goal/goal-soft-advisory-glance';
import { buildHooksSettingsLines, formatHookEventSummary } from '#/tui/utils/hooks/hooks-glance';
import { buildIndexSessionLiveLines, buildIndexSettingsLines, formatIndexStatusGlanceLine } from '#/tui/utils/index/index-glance';
import {
  formatInterventionAgeMs,
  formatInterventionAutoExpireCountdown,
  formatInterventionAutoExpireOpsHint,
  formatInterventionQueueOpsLine,
  formatInterventionQueueSettingsLine,
  getInterventionNeverHaltTip,
  INTERVENTION_ASK_MODE_FLEET_TIP,
  INTERVENTION_PARALLEL_TOOLS_NOTE,
  interventionAutoExpireRemainingMs,
  parsePermissionAutoExpireMs,
  PERMISSION_AUTO_EXPIRE_ENV,
} from '#/tui/utils/never-halt/intervention-glance';
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
import {
  formatLocalResearchCacheHitGlance,
  formatLocalResearchCacheOpsHealthLine,
  resolveLocalResearchCacheTelemetry,
} from '../../../src/tui/utils/search/local-research-cache-glance';
import { buildMcpSettingsLines, formatMcpLiveSessionLine } from '#/tui/utils/mcp/mcp-glance';
import {
  buildMediaSettingsLines,
  formatFallbackEffectiveLine,
  loadMediaSettingsGlance,
  resolveModelVisionSupport,
} from '#/tui/utils/media/media-glance';
import { buildNetworkSettingsLines, loadNetworkGlance } from '#/tui/utils/network/network-glance';
import { formatOpsTokenGlance } from '#/tui/utils/usage/ops-token-glance';
import {
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';
import type { RendererDiagnosticsSnapshot } from '#/tui/renderer';
import {
  buildPremiumSettingsLines,
  formatLiveRenderQualityLine,
  formatMotionBudgetLine,
  formatVisualQualityModeLine,
  loadPremiumVisualGlance,
} from '#/tui/utils/premium/premium-glance';
import {
  SOVEREIGN_CORE_DEFAULT_ENV,
  SOVEREIGN_UMBRELLA_ENV,
  expectedToolCountForProfile,
  formatProfileLiveStatusLine,
  formatProfileToolsBadge,
  isSovereignCoreDefaultEnabled,
  loadProfileLiveGlance,
  resolveEffectiveProfileName,
} from '#/tui/utils/agent/profile-glance';
import {
  OSS_ABSORB_LICENSE_TIP,
  PROVIDERS_FREE_SEARCH_TIP,
  buildProvidersApiSettingsLines,
  formatActiveModelLine,
  formatActiveProviderLine,
  loadProvidersApiGlance,
  resolveProvidersApiSessionGlance,
} from '#/tui/utils/provider/providers-api-glance';
import { SEARCH_PREFER_XAI_TIP } from '#/tui/commands/config/search/search-status';
import { formatOpsRouteLine } from '#/tui/utils/model/route-glance';
import {
  buildSecuritySettingsLines,
  formatMcpAllowlistLines,
  formatNetworkEgressLines,
  formatPermissionModeLine,
  formatSandboxEnforcementLine,
  formatSandboxProfileLine,
  formatWorkspaceSandboxLines,
  SECURITY_MCP_ALLOWLIST_TIP,
  SECURITY_NOT_OS_SANDBOX,
  SECURITY_REDACTION_TIP,
  SECURITY_SANDBOX_TIP,
  securityNavigationLines,
  securitySecretRedactionLines,
  securitySensorLines,
} from '#/tui/utils/security/security-glance';
import { buildSkillsSettingsLines, summarizeSkillsCatalog } from '#/tui/utils/skills/skills-glance';
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
import {
  HIDE_LEGACY_TOOL_NAMES_ENV,
  SHOW_LEGACY_TOOL_NAMES_ENV,
  SOVEREIGN_UMBRELLA_ENV as TOOLS_SOVEREIGN_UMBRELLA_ENV,
  buildToolsSessionLiveLines,
  formatHideLegacyToolsStatusLine,
  isHideLegacyToolNamesEnabled,
  resolveHideLegacyToolsGlance,
} from '#/tui/utils/tool/tools-glance';

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

describe('auth-glance', () => {
  describe('auth-glance', () => {
    it('shows bare ok when oauth is not degraded (legacy call)', () => {
      expect(formatOpsAuthLine(null)).toBe('Auth: ok');
      expect(formatOpsAuthLine(undefined)).toBe('Auth: ok');
      expect(formatOpsAuthLine({ scope: 'search', reason: 'paid_channels_cooling' })).toBe('Auth: ok');
    });

    it('appends /accounts tip on ok when showOkTip is set', () => {
      expect(formatOpsAuthLine({ degraded: null, showOkTip: true })).toBe(
        `Auth: ok · ${OPS_AUTH_OK_ACCOUNTS_TIP}`,
      );
      expect(formatOpsAuthLine({ degraded: undefined, showOkTip: true })).toBe(
        `Auth: ok · ${OPS_AUTH_OK_ACCOUNTS_TIP}`,
      );
    });

    it('prefers secrets tip when provider keys are missing', () => {
      expect(
        formatOpsAuthLine({ degraded: null, secretsMissing: true, showOkTip: true }),
      ).toBe(`Auth: ok · ${OPS_AUTH_OK_SECRETS_TIP}`);
    });

    it('shows refresh due from runtimeDegraded oauth scope', () => {
      const line = formatOpsAuthLine({
        scope: 'oauth',
        reason: 'token_refresh_failed',
        hint: 'Run /login or check Accounts pool',
      });
      expect(line).toBe('Auth: refresh due · token_refresh_failed · Run /login or check Accounts po…');
    });

    it('soft-wires pool status and oauth↓ TTL for proactive refresh degraded', () => {
      const now = 50_000;
      expect(
        formatOpsAuthLine({
          degraded: null,
          showOkTip: true,
          poolSize: 2,
          nextRefreshAtMs: now + 180_000,
          nowMs: now,
        }),
      ).toBe('Auth: ok · pool×2 · next refresh 3m');

      expect(
        formatOpsAuthLine({
          degraded: null,
          showOkTip: true,
        }),
      ).toBe(`Auth: ok · ${OPS_AUTH_OK_ACCOUNTS_TIP}`);

      const degradedAt = now - 30_000;
      const line = formatOpsAuthLine({
        scope: 'oauth',
        reason: 'refresh failed',
        atMs: degradedAt,
        nowMs: now,
      });
      expect(line).toBe('Auth: refresh due · refresh failed · oauth↓ 1m 30s');

      const statusGlance = resolveOAuthPoolGlanceFromStatus({
        oauth: { poolSize: 3, nextRefreshAtMs: now + 60_000 },
      });
      expect(statusGlance).toEqual({ poolSize: 3, nextRefreshAtMs: now + 60_000 });
      const neverHalt = buildNeverHaltOAuthResilienceLines(statusGlance, now);
      expect(neverHalt.some((row) => row.startsWith('Live: pool×3'))).toBe(true);
    });

    it('merges SessionStatus.oauth nextRefresh with config poolSize fallback', () => {
      const now = 100_000;
      const providers = {
        [SUPERLIORA_PROVIDER_NAME]: {
          type: 'kimi',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
          oauths: [{ storage: 'file', key: 'oauth/kimi-code-account-b' }],
        },
      };
      expect(resolveOAuthPoolGlanceFromConfig(providers, SUPERLIORA_PROVIDER_NAME)).toEqual({
        poolSize: 2,
      });

      const glance = resolveOAuthPoolGlance(
        { oauth: { nextRefreshAtMs: now + 120_000 } },
        providers,
        SUPERLIORA_PROVIDER_NAME,
      );
      expect(glance).toEqual({ poolSize: 2, nextRefreshAtMs: now + 120_000 });

      const line = formatOpsAuthLineFromSessionStatus({
        degraded: null,
        showOkTip: true,
        status: { oauth: { poolSize: 3, nextRefreshAtMs: now + 60_000 } },
        nowMs: now,
      });
      expect(line).toBe('Auth: ok · pool×3 · next refresh 1m');
    });

    it('buildNeverHaltOAuthResilienceLines covers proactive refresh and pool failover', () => {
      const lines = buildNeverHaltOAuthResilienceLines();
      expect(lines.join('\n')).toContain('OAuth proactive refresh');
      expect(lines.join('\n')).toContain(formatOAuthProactivePollLabel());
      expect(lines.join('\n')).toContain('failover on 401/quota');
      expect(lines.join('\n')).toContain('/login --add');
    });

    it('oauthAccountsResilienceTips mention proactive poll and pool failover', () => {
      const tips = oauthAccountsResilienceTips().join('\n');
      expect(tips).toContain('Proactive refresh');
      expect(tips).toContain('Account pool');
      expect(tips).toContain('401 failover');
    });

    it('exports Accounts picker resilience hint', () => {
      expect(ACCOUNTS_POOL_RESILIENCE_HINT).toContain('Proactive refresh');
      expect(ACCOUNTS_POOL_RESILIENCE_HINT).toContain('401/quota');
    });

    it('truncates long oauth degradation text', () => {
      const line = formatOpsAuthLine({
        scope: 'oauth',
        reason: 'A'.repeat(80),
      });
      expect(line.startsWith('Auth: refresh due · ')).toBe(true);
      expect(line).toContain('…');
      expect(line.length).toBeLessThan(90);
    });

    it('formats Ops permission line with live session SSOT', () => {
      expect(formatOpsPermissionLine('auto')).toBe('Permission: auto');
      expect(formatOpsPermissionLine('auto', 'auto')).toBe('Permission: auto · live session confirms');
      expect(formatOpsPermissionLine('auto', 'manual')).toBe('Permission: auto (TUI) · session manual');
      expect(formatOpsPermissionLine('yolo', 'yolo')).toBe(
        'Permission: yolo · live session · trusted workspace assumed',
      );
    });
  });
});

describe('breaker-glance', () => {
  const liveBreakers = {
    closed: 2,
    open: 1,
    halfOpen: 0,
    lastTripReason: 'brave 429',
    scopes: [{ id: 'search:brave', state: 'open', failures: 3, lastTripReason: '429 burst' }],
  };

  describe('resolveBreakerFromAppState', () => {
    it('returns breakers when AppState snapshot is populated', () => {
      expect(resolveBreakerFromAppState(liveBreakers)).toEqual(liveBreakers);
    });

    it('returns undefined when AppState has no breaker snapshot', () => {
      expect(resolveBreakerFromAppState(undefined)).toBeUndefined();
      expect(resolveBreakerFromAppState(null)).toBeUndefined();
    });
  });

  describe('resolveBreakerStatus', () => {
    it('prefers live getStatus over AppState', () => {
      expect(
        resolveBreakerStatus({
          appStateBreakers: { closed: 0, open: 9, halfOpen: 0 },
          statusBreakers: liveBreakers,
        }),
      ).toEqual(liveBreakers);
    });

    it('falls back to AppState when getStatus is absent', () => {
      expect(
        resolveBreakerStatus({
          appStateBreakers: liveBreakers,
        }),
      ).toEqual(liveBreakers);
    });
  });

  describe('resolveNeverHaltBreakerLines', () => {
    it('shows lastTrip from AppState registry when getStatus is unavailable', () => {
      const lines = resolveNeverHaltBreakerLines({
        appStateBreakers: liveBreakers,
        degraded: null,
      });
      expect(lines.some((line) => line.includes('Last trip: brave 429'))).toBe(true);
      expect(lines.some((line) => line.includes('search:brave: open'))).toBe(true);
    });
  });

  describe('resolveOpsBreakerLineFromAppState', () => {
    it('formats open count from AppState SSOT for Ops Runtime Health', () => {
      const line = resolveOpsBreakerLineFromAppState(liveBreakers, null);
      expect(line).toBe('Breakers: 1 open · 2 closed · last: brave 429');
    });

    it('ignores getStatus and falls back to tip when AppState registry is absent', () => {
      const line = resolveOpsBreakerLineFromAppState(null, null);
      expect(line).toBe('Breakers: (no trips) · breakers: see /settings never-halt');
    });
  });

  describe('resolveOpsBreakerLine', () => {
    it('formats last trip from AppState between getStatus refreshes', () => {
      const line = resolveOpsBreakerLine({
        appStateBreakers: liveBreakers,
        degraded: null,
      });
      expect(line).toBe('Breakers: 1 open · 2 closed · last: brave 429');
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
          cacheDiagnostics: { toolBlockChanged: false, toolBlockHash: 'abc', injectionCount: 0, messageCount: 3 },
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

describe('compaction-glance', () => {
  describe('compaction-glance', () => {
    it('exports focused tip strings for settings picker actions', () => {
      expect(COMPACTION_THRESHOLD_TIP).toContain('compactionTriggerRatio');
      expect(COMPACTION_KEEP_TOKENS_TIP).toContain('compactionMaxRecentMessages');
    });
    it('formats live archive count from session context', () => {
      expect(
        formatContextArchiveLine({ archiveEntryCount: 3, archiveMaxEntries: 512 }),
      ).toBe('Context archive: 3 entries (max 512) · Expand(id=…) recover');
    });

    it('falls back to soft tip when archive count is unavailable', () => {
      expect(formatContextArchiveLine({})).toContain('(no session)');
    });

    it('resolves last compact tip from transcript compaction markers', () => {
      const last = resolveLastCompactionFromTranscript([
        { kind: 'user', text: 'hi' } as never,
        {
          kind: 'status',
          text: 'done',
          compactionData: { tokensBefore: 120_000, tokensAfter: 45_000, instruction: 'keep tests' },
        } as never,
      ]);
      expect(formatLastCompactLine(last)).toBe('Last compact: 120k → 45k · "keep tests"');
    });

    it('builds settings lines with live session section', () => {
      const lines = buildCompactionSettingsLines({
        thresholds: {
          triggerLine: 'Soft trigger ratio: 0.7',
          asyncLine: 'Async pre-rot ratio: 0.55',
          workingSetLine: 'Working-set cap: balanced',
          keepLine: 'Keep recent: default',
        },
        session: {
          archiveEntryCount: 2,
          archiveMaxEntries: 512,
          lastCompact: { tokensBefore: 90_000, tokensAfter: 40_000 },
          contextUsage: 0.42,
          contextTokens: 105_000,
          maxContextTokens: 256_000,
        },
      });
      const text = lines.join('\n');
      expect(text).toContain('── Session (live) ──');
      expect(text).toContain('Context archive: 2 entries');
      expect(text).toContain('Last compact: 90k → 40k');
      expect(text).toContain('Context usage: 42.0%');
      expect(text).toContain('context-archive store');
    });

  });
});

describe('context-glance', () => {
  describe('context glance', () => {
    it('discovers project AGENTS.md and CLAUDE.md', () => {
      const root = mkdtempSync(join(tmpdir(), 'ctx-glance-'));
      try {
        writeFileSync(join(root, 'AGENTS.md'), '# project rules\n', 'utf8');
        writeFileSync(join(root, 'CLAUDE.md'), '# claude rules\n', 'utf8');
        const hits = discoverInstructionFiles({
          workDir: root,
          brandHome: join(root, '.brand'),
          realHome: join(root, 'home'),
        });
        const names = hits.map((hit) => hit.name);
        expect(names).toContain('AGENTS.md');
        expect(names).toContain('CLAUDE.md');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('formatInstructionFilesLine reports none when empty', () => {
      expect(formatInstructionFilesLine({ hits: [] })).toContain('none found');
    });

    it('formatLearningMemoryLine uses live counts when stats exist', () => {
      const line = formatLearningMemoryLine({
        stats: {
          total: 4,
          active: 3,
          archived: 1,
          deleted: 0,
          byType: { fact: 2, event: 1, procedure: 1, task: 0, rule: 0 },
          byScope: { user: 2, workspace: 2, session: 0 },
          candidates: 0,
        },
      });
      expect(line).toContain('3 active / 4 total');
      expect(line).toContain('fact 2');
    });

    it('buildContextSettingsLines includes live section', () => {
      const lines = buildContextSettingsLines({
        presetLine: 'Working-set preset: balanced',
        capLine: 'Caps: soft 256k · async 220k',
        instruction: { hits: [{ name: 'AGENTS.md', path: './AGENTS.md', scope: 'project' }] },
        memory: {
          stats: {
            total: 1,
            active: 1,
            archived: 0,
            deleted: 0,
            byType: { fact: 1, event: 0, procedure: 0, task: 0, rule: 0 },
            byScope: { user: 1, workspace: 0, session: 0 },
            candidates: 0,
          },
        },
      });
      const text = lines.join('\n');
      expect(text).toContain('Instruction vs Learning');
      expect(text).toContain('Live');
      expect(text).toContain('AGENTS.md (./AGENTS.md)');
      expect(text).toContain('1 active / 1 total');
    });
  });
});

describe('extensions-glance', () => {
  describe('extensions glance', () => {
    it('buildExtensionsSessionLiveLines surfaces live plugin/skill/MCP counts', () => {
      const lines = buildExtensionsSessionLiveLines({
        plugins: [
          {
            id: 'p1',
            displayName: 'Alpha',
            enabled: true,
            hasErrors: false,
            hookCount: 2,
            skillCount: 1,
            mcpServerCount: 1,
            enabledMcpServerCount: 1,
            commandCount: 0,
            state: 'ok',
            scope: 'user',
            source: 'local-path',
            agentCount: 0,
          },
          {
            id: 'p2',
            displayName: 'Beta',
            enabled: false,
            hasErrors: true,
            hookCount: 0,
            skillCount: 0,
            mcpServerCount: 0,
            enabledMcpServerCount: 0,
            commandCount: 0,
            state: 'error',
            scope: 'user',
            source: 'local-path',
            agentCount: 0,
          },
        ],
        skills: [
          { name: 'write-tui', description: '', source: 'builtin', path: '/builtin/write-tui' },
          { name: 'custom', description: '', source: 'user', path: '/home/skills/custom' },
        ],
        skillsDisabled: ['custom'],
        mcpServers: [
          { name: 'fs', transport: 'stdio', status: 'connected', toolCount: 4 },
          { name: 'web', transport: 'http', status: 'disabled', toolCount: 0 },
        ],
      }).join('\n');

      expect(lines).toContain('Plugins: 2 installed · 1 enabled · 1 with errors');
      expect(lines).toContain('Skills: 2 in catalog · 1 slash-enabled · 1 disabled');
      expect(lines).toContain('MCP: 2 server(s)');
      expect(lines).toContain('4 tools available');
      expect(lines).toContain('Hooks: 2 from 1 enabled plugin(s)');
    });

    it('buildExtensionsSettingsLines puts session live block before tips', () => {
      const text = buildExtensionsSettingsLines({
        plugins: [],
        skills: [],
        mcpServers: [],
        skillsDisabled: [],
      }).join('\n');
      const liveIdx = text.indexOf('── Session (live)');
      const auditIdx = text.indexOf('── Audit surfaces');
      expect(liveIdx).toBeGreaterThanOrEqual(0);
      expect(auditIdx).toBeGreaterThan(liveIdx);
      expect(text).toContain('Plugins: 0 installed');
      expect(text).toContain('/extensions');
    });

    it('falls back when session is unavailable', () => {
      const lines = buildExtensionsSessionLiveLines({ sessionUnavailable: true }).join('\n');
      expect(lines).toContain('session unavailable');
      expect(lines).not.toContain('installed');
    });

    it('falls back when no session data loaded', () => {
      const lines = buildExtensionsSessionLiveLines({}).join('\n');
      expect(lines).toContain('open a session to count installed plugins');
      expect(lines).toContain('open a session to inspect MCP connection status');
    });
  });
});

describe('eyes-glance', () => {
  describe('eyes glance', () => {
    it('builds tip-heavy panel from readiness report', () => {
      const text = buildEyesSettingsLines(
        loadEyesSettingsGlance({
          report: {
            generatedAt: '2026-07-31T00:00:00.000Z',
            lines: [
              browserEyeFromSetupResult({
                ok: true,
                code: 0,
                stdout: 'ready',
                stderr: '',
                command: [],
              }),
              computerEyeFromCuaStatus({ installed: false, error: 'missing' }),
            ],
          },
        }),
      ).join('\n');
      expect(text).toContain('Browser-use: OK');
      expect(text).toContain('Computer-use: MISSING');
      expect(text).toContain('liora browser-use doctor');
      expect(text).toContain('/eyes');
    });

    it('surfaces load errors without throwing', () => {
      const text = buildEyesSettingsLines(
        loadEyesSettingsGlance({ loadError: 'probe failed' }),
      ).join('\n');
      expect(text).toContain('Load error: probe failed');
    });
  });
});

describe('goal-soft-advisory-glance', () => {
  describe('goalSoftAdvisoryPatchFromToolResult', () => {
    it('sets AppState advisory after RunProjectChecks failure and clears on pass', () => {
      const sessionId = 'sess-goal-advisory';
      resetGoalSoftAdvisoryLedger(sessionId);

      const failPatch = goalSoftAdvisoryPatchFromToolResult(
        sessionId,
        'RunProjectChecks',
        {},
        true,
        JSON.stringify({ summary: 'lint failed' }),
      );
      expect(failPatch.goalSoftAdvisory).toContain('RunProjectChecks failed');
      expect(failPatch.goalSoftAdvisory).toContain('lint failed');

      const passPatch = goalSoftAdvisoryPatchFromToolResult(
        sessionId,
        'RunProjectChecks',
        {},
        false,
        JSON.stringify({ exitCode: 0 }),
      );
      expect(passPatch.goalSoftAdvisory).toBeNull();
    });
  });

  describe('formatGoalSoftAdvisoryOpsDisplayLine', () => {
    it('shows live advisory when wired', () => {
      expect(formatGoalSoftAdvisoryOpsDisplayLine('Soft sensor: Bash failed — oops')).toBe(
        'Soft sensor: Bash failed — oops',
      );
    });

    it('falls back to W6 soft tip when advisory is absent', () => {
      expect(formatGoalSoftAdvisoryOpsDisplayLine(null)).toBe(VERIFICATION_SENSOR_GOAL_DONE_TIP);
      expect(formatGoalSoftAdvisoryOpsDisplayLine(undefined)).toBe(VERIFICATION_SENSOR_GOAL_DONE_TIP);
    });
  });
});

describe('hooks-glance', () => {
  describe('hooks glance live registry', () => {
    it('formats event counts sorted by frequency', () => {
      expect(
        formatHookEventSummary({
          Stop: 1,
          PreToolUse: 3,
          PostToolUse: 2,
        }),
      ).toBe('PreToolUse×3 · PostToolUse×2 · Stop×1');
    });

    it('surfaces live HookEngine registry when wired', () => {
      const lines = buildHooksSettingsLines({
        configPath: '/home/.superliora/config.toml',
        registry: {
          totalCount: 4,
          events: { PreToolUse: 2, Stop: 2 },
        },
        pluginHookCount: 2,
        enabledPluginCount: 1,
      }).join('\n');
      expect(lines).toContain('Live registry (HookEngine)');
      expect(lines).toContain('4 hook(s)');
      expect(lines).toContain('PreToolUse×2 · Stop×2');
      expect(lines).toContain('Registered hooks: 4 in HookEngine');
    });

    it('falls back to session prompt when registry is absent', () => {
      const lines = buildHooksSettingsLines({
        configPath: '/home/.superliora/config.toml',
      }).join('\n');
      expect(lines).not.toContain('Live registry (HookEngine)');
      expect(lines).toContain('open a session to count enabled plugin hooks');
    });
  });
});

describe('index-glance', () => {
  const codemapWarm = {
    warmth: 'warm' as const,
    dbPath: '/tmp/codemap.sqlite',
    gitRepo: true,
    fileCount: 42,
    symbolCount: 128,
    note: null,
  };

  describe('index glance', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('formatIndexStatusGlanceLine summarizes repo query, codemap, engine, and FTS wire', () => {
      const repoIndex = getRepoIndexStatus({});
      const line = formatIndexStatusGlanceLine({
        repoQueryActive: true,
        codemap: codemapWarm,
        repoIndex,
      });
      expect(line).toBe('Glance: RepoQuery on · codemap warm · engine=sqlite · FTS live');
    });

    it('formatIndexStatusGlanceLine reflects cold codemap and inactive RepoQuery', () => {
      const repoIndex = getRepoIndexStatus({ [REPO_INDEX_ENGINE_ENV]: 'stub' });
      const line = formatIndexStatusGlanceLine({
        repoQueryActive: false,
        codemap: {
          warmth: 'cold',
          dbPath: '/tmp/cold.sqlite',
          gitRepo: true,
          fileCount: null,
          symbolCount: null,
          note: 'cold note',
        },
        repoIndex,
      });
      expect(line).toBe('Glance: RepoQuery off · codemap cold · engine=stub · FTS not live');
    });

    it('surfaces live engine/driver/wired lines in Status by default (sqlite)', () => {
      const repoIndex = getRepoIndexStatus({});
      const lines = buildIndexSettingsLines({
        repoQueryActive: true,
        codemap: codemapWarm,
        repoIndex,
      });
      const text = lines.join('\n');
      const statusBlock = text.split('── Today ────────────────────────────────────')[0] ?? text;

      expect(statusBlock).toContain(formatRepoIndexWiredLine(repoIndex));
      expect(statusBlock).toContain('RepoIndex engine: enabled');
      expect(statusBlock).toContain('engine=sqlite');
      expect(statusBlock).toContain('FTS backend: sqlite-fts5 (live');
      expect(statusBlock).not.toContain(REPO_INDEX_FTS_BACKEND_TIP);
      expect(text).toContain(REPO_INDEX_FTS_BACKEND_TIP);
    });

    it('shows stub lines when engine is explicitly opted out', () => {
      const repoIndex = getRepoIndexStatus({ [REPO_INDEX_ENGINE_ENV]: 'stub' });
      const lines = buildIndexSettingsLines({
        repoQueryActive: true,
        codemap: codemapWarm,
        repoIndex,
      });
      const statusBlock =
        lines.join('\n').split('── Today ────────────────────────────────────')[0] ?? '';

      expect(statusBlock).toContain('RepoIndex engine: disabled (stub');
      expect(statusBlock).toContain('engine=stub');
      expect(statusBlock).toContain('FTS backend: not wired yet');
    });

    it('shows wired live line when sqlite engine probes', () => {
      const repoIndex = getRepoIndexStatus({ SUPERLIORA_REPO_INDEX_ENGINE: 'sqlite' });
      const lines = buildIndexSettingsLines({
        repoQueryActive: false,
        codemap: codemapWarm,
        repoIndex,
      });
      const statusBlock =
        lines.join('\n').split('── Today ────────────────────────────────────')[0] ?? '';

      expect(statusBlock).toContain('RepoIndex wire: live');
      expect(statusBlock).toContain('driver=node:sqlite');
      expect(statusBlock).toContain('RepoQuery: not active');
    });

    it('buildIndexSettingsLines puts Session (live) warm status before Status', () => {
      const repoIndex = getRepoIndexStatus({});
      const lines = buildIndexSettingsLines({
        repoQueryActive: true,
        codemap: codemapWarm,
        repoIndex,
        env: {},
      });
      const text = lines.join('\n');
      const liveIdx = text.indexOf('── Session (live)');
      const statusIdx = text.indexOf('── Status ──');
      expect(liveIdx).toBeGreaterThan(-1);
      expect(statusIdx).toBeGreaterThan(liveIdx);
      expect(text).toContain(repoIndexWarmStatusLine({}));
      expect(text).toContain('Codemap warm: ON (default)');
    });

    it('buildIndexSessionLiveLines shows default engine tip when env unset', () => {
      const env = {};
      const lines = buildIndexSessionLiveLines({ env });
      const text = lines.join('\n');
      expect(text).toContain(repoIndexWarmStatusLine(env));
      expect(text).toContain(REPO_INDEX_PREFERRED_ENGINE_TIP);
      expect(text).toContain('stub|off|none');
    });

    it('buildIndexSessionLiveLines reflects sovereign umbrella env for warm reason', () => {
      const env = { SUPERLIORA_SOVEREIGN: '1' };
      const lines = buildIndexSessionLiveLines({ env });
      const text = lines.join('\n');
      expect(text).toContain(repoIndexWarmStatusLine(env));
      expect(text).toContain('SUPERLIORA_SOVEREIGN=1');
    });

    it('buildIndexSessionLiveLines omits preferred engine tip when engine is set', () => {
      const env = { SUPERLIORA_SOVEREIGN: '1', [REPO_INDEX_ENGINE_ENV]: 'sqlite' };
      const text = buildIndexSessionLiveLines({ env }).join('\n');
      expect(text).not.toContain(REPO_INDEX_PREFERRED_ENGINE_TIP);
      expect(repoIndexPreferredEngineTipLine(env)).toBeNull();
    });

    it('buildIndexSessionLiveLines omits preferred engine tip when stub opt-out is set', () => {
      const env = { [REPO_INDEX_ENGINE_ENV]: 'stub' };
      const text = buildIndexSessionLiveLines({ env }).join('\n');
      expect(text).not.toContain(REPO_INDEX_PREFERRED_ENGINE_TIP);
    });

    it('buildIndexSessionLiveLines surfaces zoekt wire probe when engine=zoekt', () => {
      vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'zoekt');
      vi.stubEnv('SUPERLIORA_ZOEKT_URL', 'http://127.0.0.1:6070');

      const repoIndex = getRepoIndexStatus();
      const lines = buildIndexSessionLiveLines({ repoIndex });
      const text = lines.join('\n');

      expect(repoIndex.engine).toBe('zoekt');
      expect(text).toContain(formatRepoIndexWiredLine(repoIndex));
      expect(text).toContain('RepoIndex wire: live');
      expect(text).toContain('engine=zoekt');
    });

    it('buildIndexSessionLiveLines shows zoekt probe reason when sidecar missing', () => {
      vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'zoekt');
      vi.stubEnv('SUPERLIORA_ZOEKT_URL', '');

      const repoIndex = getRepoIndexStatus();
      const text = buildIndexSessionLiveLines({ repoIndex }).join('\n');

      expect(text).toContain(formatRepoIndexWiredLine(repoIndex));
      expect(text).toContain('RepoIndex wire: not live');
      expect(text).toContain('engine=zoekt');
    });

    it('buildIndexSessionLiveLines omits zoekt probe when engine is not zoekt', () => {
      const env = { [REPO_INDEX_ENGINE_ENV]: 'sqlite' };
      const repoIndex = getRepoIndexStatus(env);
      const text = buildIndexSessionLiveLines({ env, repoIndex }).join('\n');

      expect(text).not.toContain('RepoIndex wire:');
    });

    it('buildIndexSettingsLines puts zoekt probe in Session (live) before Status', () => {
      vi.stubEnv(REPO_INDEX_ENGINE_ENV, 'zoekt');

      const repoIndex = getRepoIndexStatus();
      const lines = buildIndexSettingsLines({
        repoQueryActive: true,
        codemap: codemapWarm,
        repoIndex,
      });
      const text = lines.join('\n');
      const liveIdx = text.indexOf('── Session (live)');
      const statusIdx = text.indexOf('── Status ──');
      const wiredInLive = text
        .slice(liveIdx, statusIdx)
        .includes(formatRepoIndexWiredLine(repoIndex));

      expect(liveIdx).toBeGreaterThan(-1);
      expect(statusIdx).toBeGreaterThan(liveIdx);
      expect(wiredInLive).toBe(true);
    });

    it('buildIndexSettingsLines surfaces rebuild result when provided', () => {
      const repoIndex = getRepoIndexStatus({});
      const lines = buildIndexSettingsLines({
        repoQueryActive: true,
        codemap: codemapWarm,
        repoIndex,
        rebuildResult: {
          ok: true,
          ms: 900,
          warmth: 'warm',
          codemapFiles: 10,
          codemapSymbols: 25,
          contentFiles: 8,
          contentLines: 100,
          contentMs: 200,
          contentSkipped: false,
          contentSkipReason: null,
          note: null,
        },
      });
      const text = lines.join('\n');
      expect(text).toContain('── Rebuild ──');
      expect(text).toContain('Last rebuild: warm · 10 files · 25 symbols');
      expect(text).toContain('900ms');
    });
  });
});

describe('intervention-glance', () => {
  describe('intervention-glance', () => {
    const envSnapshot = { ...process.env };

    afterEach(() => {
      process.env = { ...envSnapshot };
    });
    it('exports the Never-Halt queued tip', () => {
      expect(getInterventionNeverHaltTip()).toContain('Goal/Jobs continue');
    });

    it('documents ask-mode Fleet continue during one approval wait', () => {
      expect(INTERVENTION_ASK_MODE_FLEET_TIP).toContain('Jobs and independent tools');
      expect(INTERVENTION_ASK_MODE_FLEET_TIP).toContain('independent tools');
    });

    it('documents parallel tool fanout during permission wait', () => {
      expect(INTERVENTION_PARALLEL_TOOLS_NOTE).toContain('parallel');
    });

    it('formats compact intervention ages', () => {
      expect(formatInterventionAgeMs(45_000)).toBe('45s');
      expect(formatInterventionAgeMs(125_000)).toBe('2m 5s');
    });

    it('omits queue line when depth is zero', () => {
      expect(formatInterventionQueueOpsLine(0, 60_000)).toBeNull();
    });

    it('shows queue depth and oldest age', () => {
      const line = formatInterventionQueueOpsLine(3, 125_000);
      expect(line).toContain('Never-Halt queue: 3 pending');
      expect(line).toContain('oldest 2m 5s');
    });

    it('includes stale×N when stale entries exist', () => {
      const line = formatInterventionQueueOpsLine(2, 30_000, 1);
      expect(line).toContain('stale×1');
    });

    it('omits auto-expire hint when the queue is fresh', () => {
      expect(formatInterventionAutoExpireOpsHint(0)).toBeNull();
    });

    it('parses SUPERLIORA_PERMISSION_AUTO_EXPIRE_MS from env', () => {
      delete process.env[PERMISSION_AUTO_EXPIRE_ENV];
      expect(parsePermissionAutoExpireMs()).toBeUndefined();
      process.env[PERMISSION_AUTO_EXPIRE_ENV] = '120000';
      expect(parsePermissionAutoExpireMs()).toBe(120_000);
      process.env[PERMISSION_AUTO_EXPIRE_ENV] = '0';
      expect(parsePermissionAutoExpireMs()).toBeUndefined();
    });

    it('computes remaining auto-expire TTL from oldest queue age', () => {
      expect(interventionAutoExpireRemainingMs(90_000, 120_000)).toBe(30_000);
      expect(interventionAutoExpireRemainingMs(130_000, 120_000)).toBe(-10_000);
      expect(interventionAutoExpireRemainingMs(undefined, 120_000)).toBeUndefined();
    });

    it('formats orphan drop countdown for Never-Halt live', () => {
      expect(formatInterventionAutoExpireCountdown(90_000, 120_000)).toBe('orphan drop in 30s');
      expect(formatInterventionAutoExpireCountdown(130_000, 120_000)).toBe('orphan drop imminent');
      expect(formatInterventionAutoExpireCountdown(30_000, undefined)).toBeNull();
    });

    it('surfaces env fallback when stale entries exist but auto-expire is unset', () => {
      delete process.env[PERMISSION_AUTO_EXPIRE_ENV];
      const hint = formatInterventionAutoExpireOpsHint(2);
      expect(hint).toContain(PERMISSION_AUTO_EXPIRE_ENV);
      expect(hint).toContain('Never-Halt');
    });

    it('surfaces orphan drop countdown in Ops hint when auto-expire is configured', () => {
      process.env[PERMISSION_AUTO_EXPIRE_ENV] = '120000';
      const hint = formatInterventionAutoExpireOpsHint(2, 90_000);
      expect(hint).toBe('Orphans: orphan drop in 30s');
    });

    it('formats settings live queue line from getStatus fields', () => {
      expect(
        formatInterventionQueueSettingsLine({
          pendingInterventions: 2,
          oldestInterventionAgeMs: 30_000,
          staleInterventions: 1,
        }),
      ).toContain('Goal/Jobs continue');
      expect(
        formatInterventionQueueSettingsLine({
          pendingInterventions: 2,
          oldestInterventionAgeMs: 90_000,
          staleInterventions: 1,
        }),
      ).toContain('Never-Halt queue: 2 pending');
      process.env[PERMISSION_AUTO_EXPIRE_ENV] = '120000';
      expect(
        formatInterventionQueueSettingsLine({
          pendingInterventions: 2,
          oldestInterventionAgeMs: 90_000,
          staleInterventions: 1,
        }),
      ).toContain('orphan drop in 30s');
      expect(
        formatInterventionQueueSettingsLine({
          pendingInterventions: 0,
        }),
      ).toBe('Live queue: (clear) · Goal/Jobs continue');
      expect(
        formatInterventionQueueSettingsLine({
          sessionUnavailable: true,
        }),
      ).toBe('Live queue: (session unavailable)');
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

    it('tags Plan / Agents / Jobs slash samples', () => {
      expect(keymapBindingsForSlash('/plan').map((b) => b.id)).toEqual(['interrupt', 'steer']);
      expect(keymapBindingsForSlash('/jobs dock').map((b) => b.id)).toEqual([
        'interrupt',
        'steer',
        'background',
      ]);
      expect(keymapBindingsForSlash('/jobs').map((b) => b.id)).toEqual([
        'job-deck',
        'background',
      ]);
      expect(keymapBindingsForSlash('/mission')).toEqual([]);
      expect(formatKeymapBindingSample(keymapBindingsForSlash('/plan')[0]!)).toContain(
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
      expect(lines).toContain('Plan / Agents / Transcript samples');
      expect(lines).toContain('/help');
      expect(lines).toContain(String(KEYMAP_ALL.length));
      expect(lines).toContain(
        `${process.platform === 'darwin' ? 'Cmd-C' : 'Ctrl-C'} — Stop the current turn`,
      );
      expect(lines).toContain('Ctrl-O — Cycle transcript density');
      expect(lines).toContain('Ctrl-B — Background the current work');
      expect(lines).toContain('No keybinding editor here');
    });
  });
});

describe('local-research-cache-glance', () => {
  describe('local research cache hit glance', () => {
    it('formats hit rate and lookup counts from usage.localResearchCache', () => {
      expect(
        formatLocalResearchCacheHitGlance({
          localResearchCache: { hitRate: 0.75, hits: 3, misses: 1 },
        }),
      ).toBe('hit 75% · 3/4 lookups');
    });

    it('derives hit rate from hits and misses when hitRate is absent', () => {
      expect(
        formatLocalResearchCacheHitGlance({
          localResearchCache: { hits: 2, misses: 2 },
        }),
      ).toBe('hit 50% · 2/4 lookups');
    });

    it('returns null before telemetry is present on usage', () => {
      expect(formatLocalResearchCacheHitGlance(undefined)).toBeNull();
      expect(formatLocalResearchCacheHitGlance({})).toBeNull();
    });

    it('resolves telemetry from usage slice', () => {
      expect(
        resolveLocalResearchCacheTelemetry({
          localResearchCache: { hitRate: 1, hits: 5, misses: 0 },
        }),
      ).toEqual({ hitRate: 1, hits: 5, misses: 0 });
    });

    it('formats Ops Runtime Health line from usage.localResearchCache', () => {
      expect(
        formatLocalResearchCacheOpsHealthLine({
          localResearchCache: { hitRate: 0.8, hits: 4, misses: 1 },
        }),
      ).toBe('LocalResearchCache: hit 80% · 4/5 lookups');
      expect(formatLocalResearchCacheOpsHealthLine(undefined)).toBeNull();
      expect(formatLocalResearchCacheOpsHealthLine({})).toBeNull();
    });
  });
});

describe('mcp-glance', () => {
  describe('mcp glance', () => {
    it('formats live session line with status breakdown and tool count', () => {
      const line = formatMcpLiveSessionLine([
        { name: 'a', transport: 'stdio', status: 'connected', toolCount: 3 },
        { name: 'b', transport: 'http', status: 'disabled', toolCount: 0 },
        { name: 'c', transport: 'stdio', status: 'failed', toolCount: 0 },
      ]);
      expect(line).toContain('3 server(s)');
      expect(line).toContain('1 connected');
      expect(line).toContain('1 disabled');
      expect(line).toContain('1 failed');
      expect(line).toContain('3 tools available');
    });

    it('builds tip panel with live rows and config scopes', () => {
      const lines = buildMcpSettingsLines({
        live: [
          { name: 'filesystem', transport: 'stdio', status: 'connected', toolCount: 2 },
          { name: 'remote', transport: 'http', status: 'pending', toolCount: 0 },
        ],
        config: {
          configured: 2,
          paths: ['user: ~/.superliora/mcp.json (2)'],
        },
      });
      const text = lines.join('\n');
      expect(text).toContain('Live session: 2 server(s)');
      expect(text).toContain('filesystem — connected');
      expect(text).toContain('mcp.json: 2 server(s)');
      expect(text).toContain('/mcp status');
    });

    it('falls back when no session', () => {
      const text = buildMcpSettingsLines({}).join('\n');
      expect(text).toContain('open a session to inspect MCP connection status');
      expect(text).toContain('no entries yet');
    });
  });
});

describe('media-glance', () => {
  describe('media glance', () => {
    it('detects vision support from model capabilities', () => {
      expect(
        resolveModelVisionSupport({
          model: 'text-only',
          availableModels: {
            'text-only': { provider: 'test', model: 'text-only', maxContextSize: 128_000, capabilities: ['tool_use'] },
          },
        }),
      ).toEqual({ supportsImageIn: false, supportsVideoIn: false });

      expect(
        resolveModelVisionSupport({
          model: 'vision',
          availableModels: {
            vision: { provider: 'test', model: 'vision', maxContextSize: 128_000, capabilities: ['image_in', 'video_in'] },
          },
        }),
      ).toEqual({ supportsImageIn: true, supportsVideoIn: true });
    });

    it('formats analyze fallback when model lacks vision', () => {
      const line = formatFallbackEffectiveLine(
        loadMediaSettingsGlance({
          policy: 'analyze',
          model: 'text-only',
          availableModels: {
            'text-only': { provider: 'test', model: 'text-only', maxContextSize: 128_000, capabilities: ['tool_use'] },
          },
          configPath: '/home/.superliora/config.toml',
        }),
      );
      expect(line).toContain('analyze');
    });

    it('builds tip-heavy panel with live policy and model lines', () => {
      const text = buildMediaSettingsLines(
        loadMediaSettingsGlance({
          policy: 'path',
          model: 'gpt-text',
          availableModels: {
            'gpt-text': { provider: 'test', model: 'gpt-text', maxContextSize: 128_000, capabilities: ['tool_use'] },
          },
          configPath: '/home/.superliora/config.toml',
        }),
      ).join('\n');
      expect(text).toContain('Fallback policy: path');
      expect(text).toContain('Current model: gpt-text');
      expect(text).toContain('nonVisionFallback');
      expect(text).toContain('/media');
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

describe('premium-glance', () => {
  const ENV_KEYS = ['TERM', 'CI', 'NO_COLOR', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT'] as const;

  function degradedDiagnostics(): RendererDiagnosticsSnapshot {
    return {
      severity: 'degraded',
      health: 'degraded',
      frames: 4,
      windowFrames: 4,
      quality: {
        level: 'balanced',
        consecutiveOverBudgetFrames: 2,
        consecutiveOutputPressureFrames: 0,
        consecutiveUnderBudgetFrames: 0,
        changes: 1,
        lastChangeReason: 'over-budget',
      },
      avgDurationMs: 14,
      p95DurationMs: 18,
      p99DurationMs: 18,
      maxDurationMs: 18,
      avgRenderCallbackDurationMs: 10,
      maxRenderCallbackDurationMs: 12,
      avgPresentDurationMs: 2,
      maxPresentDurationMs: 3,
      avgDiffDurationMs: 0.5,
      maxDiffDurationMs: 1,
      avgEncodeDurationMs: 1,
      maxEncodeDurationMs: 1.5,
      avgWriteDurationMs: 0.5,
      maxWriteDurationMs: 1,
      avgQualityDurationMs: 0,
      maxQualityDurationMs: 0,
      dominantPhase: 'render',
      dominantPhaseDurationMs: 10,
      dominantPhaseRatio: 10 / 14,
      avgFrameIntervalMs: 16,
      avgFps: 62.5,
      overBudgetRatio: 0.5,
      avgFrameBudgetRatio: 1.2,
      avgScanRatio: 0.12,
      maxScanRatio: 0.2,
      avgDamageRatio: 1,
      maxDamageRatio: 1,
      dominantScanStrategy: 'dirty-rows',
      avgOutputBytes: 4096,
      outputBackpressureFrames: 0,
      outputBackpressureRatio: 0,
      avgOutputCells: 16,
      avgOutputRuns: 4,
      avgOutputBridgedCells: 2,
      avgOutputBridgedCellRatio: 0.125,
      avgCursorAbsoluteMoves: 1,
      avgCursorRelativeMoves: 2,
      avgCursorHorizontalAbsoluteMoves: 0,
      avgCursorMoveBytes: 12,
      avgCursorMoveSavedBytes: 6,
      avgChangedCellRatio: 0.1,
      avgCompositionReuseRatio: 0.5,
      avgLineCacheHitRatio: 0.75,
      lastOutputMode: 'full',
      lastOutputSynchronized: true,
      lastOutputLargeFrame: true,
      lastOutputPolicyReason: 'full-frame',
      lastOutputEraseLine: true,
      frameTimeSparkline: '▆█',
      issues: [],
    };
  }

  describe('premium visual glance', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      for (const key of ENV_KEYS) delete process.env[key];
      process.env['TERM'] = 'xterm-256color';
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');
    });

    it('formats harness Visual Quality mode from appState', () => {
      const on = loadPremiumVisualGlance({
        premiumQualityMode: true,
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        renderQuality: 'full',
        renderHealth: 'healthy',
      });
      expect(formatVisualQualityModeLine(on)).toContain('Visual Quality: ON');
      expect(formatVisualQualityModeLine({ ...on, sessionPremiumQuality: false })).toContain(
        'syncing',
      );
    });

    it('wires live render quality and frame health from appearance module', () => {
      setAppearanceRenderQuality('balanced');
      setAppearanceRenderHealth('watch');
      const glance = loadPremiumVisualGlance({
        premiumQualityMode: false,
        appearance: {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          profile: 'premium',
          particles: 'premium',
          animationFps: 30,
        },
        renderQuality: getAppearanceRenderQuality(),
        renderHealth: getAppearanceRenderHealth(),
      });
      expect(formatLiveRenderQualityLine(glance)).toBe(
        'Render quality: balanced · frame health: watch',
      );
      expect(formatMotionBudgetLine(glance)).toContain('premium ambient');
      // watch health keeps the 30fps premium cadence (33ms); soft-degrade needs harder load.
      expect(formatMotionBudgetLine(glance)).toContain('33ms');
    });

    it('includes native frame budget ratio when diagnostics are wired', () => {
      const glance = loadPremiumVisualGlance({
        premiumQualityMode: true,
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        renderQuality: 'high',
        renderHealth: 'degraded',
        diagnostics: degradedDiagnostics(),
      });
      expect(formatMotionBudgetLine(glance)).toContain('frame budget 120% avg');
      expect(formatLiveRenderQualityLine(glance)).toContain('adaptive balanced');
    });

    it('reports forced-off motion under CI', () => {
      process.env['CI'] = '1';
      const glance = loadPremiumVisualGlance({
        premiumQualityMode: false,
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        renderQuality: 'full',
        renderHealth: 'healthy',
      });
      expect(formatMotionBudgetLine(glance)).toContain('forced off');
    });

    it('builds settings panel lines with live session block', () => {
      const text = buildPremiumSettingsLines(
        loadPremiumVisualGlance({
          premiumQualityMode: true,
          appearance: DEFAULT_APPEARANCE_PREFERENCES,
          renderQuality: 'full',
          renderHealth: 'healthy',
          sessionPremiumQuality: true,
        }),
      ).join('\n');
      expect(text).toContain('── Session (live) ─');
      expect(text).toContain('Visual Quality: ON');
      expect(text).toContain('/premium on|off');
      expect(text).toContain('Settings → Appearance');
    });
  });
});

describe('profile-glance', () => {
  describe('profile-glance', () => {
    it('defaults to conductor when no env or config override', () => {
      expect(resolveEffectiveProfileName(undefined, undefined, {})).toBe('conductor');
      const glance = loadProfileLiveGlance({ env: {} });
      expect(glance.effectiveProfile).toBe('conductor');
      expect(glance.sovereignCoreOptIn).toBe(false);
      expect(glance.expectedToolCount).toBe(26); // conductor
      expect(formatProfileToolsBadge(glance)).toBe('profile=conductor tools=26');
      expect(formatProfileLiveStatusLine(glance)).toBe(
        'Conductor: ON (default) · profile=conductor tools=26',
      );
    });

    it('still defaults to conductor when SUPERLIORA_SOVEREIGN_CORE=1 and profile unset', () => {
      const env = { [SOVEREIGN_CORE_DEFAULT_ENV]: '1' };
      expect(resolveEffectiveProfileName(undefined, undefined, env)).toBe('conductor');
      const glance = loadProfileLiveGlance({ env });
      expect(glance.effectiveProfile).toBe('conductor');
      expect(glance.sovereignCoreOptIn).toBe(true);
      expect(glance.sovereignCoreTrigger).toBe(SOVEREIGN_CORE_DEFAULT_ENV);
      expect(formatProfileLiveStatusLine(glance)).toBe(
        'Conductor: ON (default) · profile=conductor tools=26',
      );
    });

    it('prefers SUPERLIORA_PROFILE env over hard default', () => {
      const env = {
        [SOVEREIGN_CORE_DEFAULT_ENV]: '1',
        SUPERLIORA_PROFILE: 'agent',
      };
      const glance = loadProfileLiveGlance({ env });
      expect(glance.effectiveProfile).toBe('agent');
      expect(glance.expectedToolCount).toBe(33);
      expect(isSovereignCoreDefaultEnabled(env)).toBe(true);
      expect(formatProfileToolsBadge(glance)).toBe('profile=agent tools=33');
      expect(formatProfileLiveStatusLine(glance)).toBe('Core waist: OFF · profile=agent tools=33');
    });

    it('enables sovereign soft flag via umbrella env without forcing core profile', () => {
      const env = { [SOVEREIGN_UMBRELLA_ENV]: '1' };
      const glance = loadProfileLiveGlance({ env });
      expect(glance.effectiveProfile).toBe('conductor');
      expect(glance.sovereignCoreTrigger).toBe(SOVEREIGN_UMBRELLA_ENV);
      expect(formatProfileLiveStatusLine(glance)).toBe(
        'Conductor: ON (default) · profile=conductor tools=26',
      );
    });

    it('uses config profile when env profile unset', () => {
      const glance = loadProfileLiveGlance({ configProfile: 'core', env: {} });
      expect(glance.effectiveProfile).toBe('core');
      expect(formatProfileLiveStatusLine(glance)).toBe('Core waist: ON · profile=core tools=12');
    });

    it('maps bundled waist sizes for diagnostics', () => {
      expect(expectedToolCountForProfile('core')).toBe(12);
      expect(expectedToolCountForProfile('agent')).toBe(33);
      expect(expectedToolCountForProfile('conductor')).toBe(26);
      expect(expectedToolCountForProfile('custom-profile')).toBeUndefined();
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
      expect(lines).toContain('Proactive refresh');
      expect(lines).toContain('Account pool');
      expect(lines).toContain('401 failover');
      expect(lines).toContain('KIMI_API_KEY');
      expect(lines).toContain(PROVIDERS_FREE_SEARCH_TIP);
      expect(lines).toContain(OSS_ABSORB_LICENSE_TIP);
      expect(lines).not.toContain('PreferXai');
    });

    it('surfaces PreferXai tip only when WebSearch is active in session', () => {
      const withWeb = buildProvidersApiSettingsLines({
        configuredLabels: [],
        registryKeySet: false,
        providerKeySet: false,
        webSearchActive: true,
      }).join('\n');
      expect(withWeb).toContain(SEARCH_PREFER_XAI_TIP);
      expect(withWeb).toContain(PROVIDERS_FREE_SEARCH_TIP);

      const withoutWeb = buildProvidersApiSettingsLines({
        configuredLabels: [],
        registryKeySet: false,
        providerKeySet: false,
        webSearchActive: false,
      }).join('\n');
      expect(withoutWeb).not.toContain('PreferXai');
      expect(withoutWeb).toContain(OSS_ABSORB_LICENSE_TIP);
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

    it('appends Never-Halt queue line when interventions are pending', () => {
      const line = formatPermissionModeLine('manual', 'manual', {
        pendingInterventions: 2,
        oldestInterventionAgeMs: 45_000,
      });
      expect(line).toContain('Never-Halt queue');
      expect(line).toContain('2 pending');
    });

    it('lists workspace root, sandbox profile, extra dirs, and honest OS disclaimer', () => {
      const lines = formatWorkspaceSandboxLines('/tmp/project', ['/tmp/extra'], 'read-only');
      expect(lines.some((l) => l.includes('Workspace root: /tmp/project'))).toBe(true);
      expect(lines.some((l) => l.includes('Sandbox profile: read-only'))).toBe(true);
      expect(lines.some((l) => l.includes('/add-dir'))).toBe(true);
      expect(lines.some((l) => l.includes('Not an OS sandbox'))).toBe(true);
      expect(formatSandboxProfileLine('workspace')).toContain('stay inside workspace roots');
      expect(formatSandboxProfileLine('workspace')).toMatch(/Bash path tokens/);
      expect(formatSandboxProfileLine(undefined)).toContain('off');
      expect(formatSandboxEnforcementLine('process')).toMatch(/Job Object/);
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

    it('summarizes live MCP servers and config allowlists', () => {
      const lines = formatMcpAllowlistLines(
        [
          { status: 'connected' },
          { status: 'connected' },
          { status: 'disabled' },
        ],
        { configured: 2, withEnabledTools: 1, withDisabledTools: 1 },
      );
      expect(lines[0]).toContain('3 server(s)');
      expect(lines[0]).toContain('2 connected');
      expect(lines[0]).toContain('1 disabled');
      expect(lines.some((l) => l.includes('enabledTools allowlist'))).toBe(true);
      expect(lines.some((l) => l.includes('disabledTools wins'))).toBe(true);
      expect(lines.some((l) => l.includes('Scopes merge'))).toBe(true);
    });

    it('exports compact sandbox, redaction, and MCP allowlist tips without OS-sandbox claims', () => {
      expect(SECURITY_SANDBOX_TIP).toContain('not OS isolation');
      expect(SECURITY_SANDBOX_TIP).toContain('sandboxProfile');
      expect(SECURITY_SANDBOX_TIP).toContain('read-only');
      expect(SECURITY_SANDBOX_TIP).toMatch(/Bash/);
      expect(SECURITY_NOT_OS_SANDBOX).toContain('Not an OS sandbox');
      expect(SECURITY_NOT_OS_SANDBOX).toMatch(/Bash path tokens/);
      expect(SECURITY_NOT_OS_SANDBOX).toMatch(/Script/);
      expect(SECURITY_REDACTION_TIP).toContain('redactSecretsInText');
      expect(SECURITY_MCP_ALLOWLIST_TIP).toContain('enabledTools');
    });

    it('lists verification sensor tips including PostToolUse RunProjectChecks', () => {
      expect(securitySensorLines().join('\n')).toContain('RunProjectChecks');
      expect(securitySensorLines().join('\n')).toContain('PostToolUse');
      expect(securitySensorLines().join('\n')).toContain('W6 soft sensor');
      expect(securitySensorLines().join('\n')).toContain('non-blocking');
    });

    it('builds full security panel lines with live permission, sandbox, and network', () => {
      const lines = buildSecuritySettingsLines({
        permissionMode: 'auto',
        permissionFromSession: 'auto',
        permissionInterventions: { pendingInterventions: 1, oldestInterventionAgeMs: 12_000 },
        sandboxProfile: 'workspace',
        sandboxEnforcement: 'process',
        processSandboxWarning: 'Docker Desktop not found — using a Windows Job Object.',
        workDir: '/workspace/demo',
        additionalDirs: [],
        network: loadNetworkGlance({}),
        mcpLive: [{ status: 'connected' }],
        mcpConfig: { configured: 1, withEnabledTools: 0, withDisabledTools: 0 },
      });
      const text = lines.join('\n');
      expect(text).toContain('§9.2');
      expect(text).toContain('live session confirms');
      expect(text).toContain('Never-Halt queue');
      expect(text).toContain('Sandbox profile: workspace');
      expect(text).toContain('Sandbox enforcement: process');
      expect(text).toContain('Job Object');
      expect(text).toContain('Not an OS sandbox');
      expect(text).toContain('Network egress');
      expect(text).toContain('Verification sensors');
      expect(text).toContain('RunProjectChecks');
      expect(text).toContain('/workspace/demo');
      expect(text).toContain('Settings → MCP');
      expect(text).toContain('Settings → Network / Proxy');
      expect(text).toContain('redactSecretsInText');
      expect(text).toContain('redteam-soft');
      expect(text).toContain('disabledTools wins');
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

describe('skills-glance', () => {
  describe('skills glance live catalog', () => {
    it('summarizes installed, enabled, and source breakdown', () => {
      const catalog = summarizeSkillsCatalog(
        [
          { name: 'write-tui', source: 'builtin' },
          { name: 'custom', source: 'user' },
          { name: 'proj', source: 'project' },
        ],
        ['custom'],
      );
      expect(catalog).toEqual({
        installedCount: 3,
        enabledCount: 2,
        disabledCount: 1,
        bySource: { builtin: 1, user: 1, project: 1 },
      });
    });

    it('surfaces live catalog counts when wired', () => {
      const lines = buildSkillsSettingsLines({
        homeDir: '/home/.superliora',
        catalog: {
          installedCount: 5,
          enabledCount: 4,
          disabledCount: 1,
          bySource: { builtin: 3, user: 2 },
        },
        searchSkillActive: true,
      }).join('\n');
      expect(lines).toContain('Installed skills: 5 in catalog · 4 slash-enabled · 1 disabled');
      expect(lines).toContain('Catalog sources (live): builtin 3 · user 2');
      expect(lines).toContain('SearchSkill: active in this session');
    });

    it('falls back when session catalog is absent', () => {
      const lines = buildSkillsSettingsLines({
        homeDir: '/home/.superliora',
      }).join('\n');
      expect(lines).toContain('open a session to count catalog');
      expect(lines).not.toContain('Catalog sources (live)');
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
        totalListed: 12,
        bundled: 4,
        custom: 2,
        plugin: 1,
        bundledExternal: 5,
      });
      expect(line).toContain('12 listed');
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

describe('tools-glance', () => {
  describe('tools-glance hide-legacy', () => {
    it('enables by default when env is unset', () => {
      expect(isHideLegacyToolNamesEnabled({})).toBe(true);
    });

    it('disables when SUPERLIORA_SHOW_LEGACY_TOOL_NAMES=1', () => {
      expect(isHideLegacyToolNamesEnabled({ [SHOW_LEGACY_TOOL_NAMES_ENV]: '1' })).toBe(false);
      expect(isHideLegacyToolNamesEnabled({ [SHOW_LEGACY_TOOL_NAMES_ENV]: 'true' })).toBe(false);
    });

    it('enables when SUPERLIORA_HIDE_LEGACY_TOOL_NAMES is non-empty', () => {
      expect(isHideLegacyToolNamesEnabled({ [HIDE_LEGACY_TOOL_NAMES_ENV]: '1' })).toBe(true);
      expect(isHideLegacyToolNamesEnabled({ [HIDE_LEGACY_TOOL_NAMES_ENV]: 'yes' })).toBe(true);
    });

    it('prefers explicit hide-legacy env as trigger over sovereign umbrella', () => {
      const glance = resolveHideLegacyToolsGlance({
        hiddenCompatAliases: ['LioraReview→Review'],
        env: {
          [HIDE_LEGACY_TOOL_NAMES_ENV]: '1',
          [TOOLS_SOVEREIGN_UMBRELLA_ENV]: '1',
        },
      });
      expect(glance.enabled).toBe(true);
      expect(glance.trigger).toBe(HIDE_LEGACY_TOOL_NAMES_ENV);
      expect(formatHideLegacyToolsStatusLine(glance)).toContain(
        `${HIDE_LEGACY_TOOL_NAMES_ENV}=1`,
      );
    });

    it('formats default ON line with compat count from inventory filter', () => {
      const line = formatHideLegacyToolsStatusLine(
        resolveHideLegacyToolsGlance({
          hiddenCompatAliases: ['LioraReview→Review'],
          env: {},
        }),
      );
      expect(line).toBe('Hide legacy: ON (default) · 1 compat alias(es) off primary help');
    });

    it('formats OFF line when SHOW_LEGACY opt-out is set', () => {
      const line = formatHideLegacyToolsStatusLine(
        resolveHideLegacyToolsGlance({
          hiddenCompatAliases: ['LioraReview→Review'],
          env: { [SHOW_LEGACY_TOOL_NAMES_ENV]: '1' },
        }),
      );
      expect(line).toBe('Hide legacy: OFF · 1 compat alias(es) off primary help');
    });

    it('builds Session (live) block before inventory', () => {
      const profile = loadProfileLiveGlance({});
      const lines = buildToolsSessionLiveLines({
        activeCount: 3,
        registeredCount: 5,
        hideLegacy: resolveHideLegacyToolsGlance({
          hiddenCompatAliases: [],
          env: {},
        }),
        profile,
      });
      expect(lines[0]).toContain('Session (live)');
      expect(lines[1]).toBe('Conductor: ON (default) · profile=conductor tools=26');
      expect(lines[2]).toBe('Tools: 3 active / 5 registered');
      expect(lines[3]).toContain('Hide legacy: ON (default)');
    });
  });
});
