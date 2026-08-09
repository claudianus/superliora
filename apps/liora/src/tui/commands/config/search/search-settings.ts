/**
 * Settings → Search — channel health / key detection / free-fallback / strategy / Ch4–5.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { PlainTextInputDialogComponent } from '../../../components/dialogs/shared/plain-text-input-dialog';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { formatLocalResearchCacheHitGlance } from '../../../utils/search/local-research-cache-glance';
import { formatSearchFreeOnlyKpiSessionGlance } from '../../../utils/search/search-free-only-kpi';
import { formatSearchNeverEmptyTelemetryGlance } from '../../../utils/search/search-never-empty-telemetry';
import {
  ALLOW_DISABLE_FREE_FALLBACK_ENV,
  buildSearchBrowserEscalateConfigPatch,
  buildSearchClearSearxngUrlConfigPatch,
  buildSearchFreeFallbackConfigPatch,
  buildSearchPreferXaiConfigPatch,
  buildSearchSearxngUrlConfigPatch,
  buildSearchSettingsStatusLines,
  buildSearchStrategyConfigPatch,
  detectSearchLateChannelEnv,
  detectSearchProviderEnvKeys,
  isValidSearxngUrl,
  resolveLocalResearchCacheStatus,
  resolveSearchBrowserEscalate,
  resolveSearchFreeFallback,
  resolveSearchPreferXai,
  resolveSearchStrategy,
  SEARCH_ROUTING_STRATEGY_OPTIONS,
  type SearchRoutingStrategySetting,
} from './search-status';

import { SEARCH_PRESETS } from '#/tui/utils/settings/search-presets';
import { SETTINGS_PRESETS_ROW, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { ttui } from '../../../utils/tui-i18n';

export function showSearchSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.search.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        SETTINGS_PRESETS_ROW,
        {
          value: 'status',
          label: 'Channel status',
          description:
            'Escalate ladder Ch1–5 · strategy · browser escalate · never-empty soft-fail.',
        },
        {
          value: 'strategy',
          label: 'Routing strategy',
          description: 'harness.setConfig → research.search.strategy (auto / parallel / …).',
        },
        {
          value: 'browser-on',
          label: 'Browser escalate ON (Ch4/Ch5 default)',
          description:
            'research.search.browserEscalate = true · WebSearch may escalate after empty SERP.',
        },
        {
          value: 'browser-off',
          label: 'Browser escalate OFF',
          description:
            'Skip Ch4/Ch5 unless DeepResearch passes allow_browser: true / depth: exhaustive.',
        },
        {
          value: 'prefer-xai-on',
          label: 'PreferXai ON (Grok Build first)',
          description:
            'research.search.preferXai = true · xAI web search before ResearchSearchEngine.',
        },
        {
          value: 'prefer-xai-off',
          label: 'PreferXai OFF',
          description: 'Skip PreferXai wrap — cascade / local search only (xAI alone if no cascade).',
        },
        {
          value: 'searxng-set',
          label: 'Set SearXNG URL (Ch2)',
          description: 'harness.setConfig → research.localSearch.searxngUrl (http/https).',
        },
        {
          value: 'searxng-clear',
          label: 'Clear SearXNG URL',
          description: 'Remove config URL — env SUPERLIORA_SEARXNG_URL may still apply.',
        },
        {
          value: 'free-on',
          label: 'Free fallback ON (Never-Empty default)',
          description:
            'harness.setConfig → research.search.freeFallback = true · DDG/local last resort.',
        },
        {
          value: 'free-off',
          label: 'Free fallback OFF (advanced — blocked by default)',
          description:
            `Requires ${ALLOW_DISABLE_FREE_FALLBACK_ENV}=1 · otherwise free fallback stays ON.`,
        },
        {
          value: 'tips',
          label: 'Setup tips',
          description: 'Env vars for Brave, Tavily, Exa, Serper, Google, Bing.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'presets') {
          showSettingPresetsPicker(host, {
            title: ttui('tui.settings.pane.search.presets'),
            catalog: SEARCH_PRESETS,
            onApply: async (preset) => {
              try {
                const strategy = preset.patch.strategy as SearchRoutingStrategySetting | undefined;
                if (strategy !== undefined) {
                  await host.harness.setConfig(buildSearchStrategyConfigPatch(strategy));
                }
                if (preset.patch.freeFallback !== undefined) {
                  await host.harness.setConfig(
                    buildSearchFreeFallbackConfigPatch(preset.patch.freeFallback),
                  );
                }
                if (preset.patch.browserEscalate !== undefined) {
                  await host.harness.setConfig(
                    buildSearchBrowserEscalateConfigPatch(preset.patch.browserEscalate),
                  );
                }
                host.showStatus(ttui('tui.search.presetApplied', { label: preset.label }), 'success');
              } catch (error) {
                host.showError(
                  `Failed to apply search preset: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            },
          });
          return;
        }
        if (value === 'status' || value === 'tips') {
          void showSearchStatusPanel(host);
          return;
        }
        if (value === 'strategy') {
          showSearchStrategyPicker(host);
          return;
        }
        if (value === 'browser-on') {
          void setBrowserEscalate(host, true);
          return;
        }
        if (value === 'browser-off') {
          void setBrowserEscalate(host, false);
          return;
        }
        if (value === 'prefer-xai-on') {
          void setPreferXai(host, true);
          return;
        }
        if (value === 'prefer-xai-off') {
          void setPreferXai(host, false);
          return;
        }
        if (value === 'searxng-set') {
          promptSearxngUrl(host);
          return;
        }
        if (value === 'searxng-clear') {
          void clearSearxngUrl(host);
          return;
        }
        if (value === 'free-on') {
          void setFreeFallback(host, true);
          return;
        }
        if (value === 'free-off') {
          if (process.env[ALLOW_DISABLE_FREE_FALLBACK_ENV] !== '1') {
            host.showStatus(
              'Free fallback stays ON ($0 DDG/local last resort). Set SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK=1 to disable.',
              'warning',
            );
            return;
          }
          void setFreeFallback(host, false);
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Search' },
  );
}

function showSearchStrategyPicker(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.search.routingStrategy'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: SEARCH_ROUTING_STRATEGY_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
      })),
      onSelect: (value) => {
        dismissPickerDialog(host);
        void setSearchStrategy(host, value as SearchRoutingStrategySetting);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Search strategy' },
  );
}

async function setSearchStrategy(
  host: SlashCommandHost,
  strategy: SearchRoutingStrategySetting,
): Promise<void> {
  try {
    await host.harness.setConfig(buildSearchStrategyConfigPatch(strategy));
    host.showStatus(ttui('tui.search.strategySet', { strategy }), 'success');
  } catch (error) {
    host.showStatus(
      `Failed to update search strategy: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

async function setBrowserEscalate(host: SlashCommandHost, enabled: boolean): Promise<void> {
  try {
    await host.harness.setConfig(buildSearchBrowserEscalateConfigPatch(enabled));
    host.showStatus(
      enabled
        ? 'Browser escalate ON (Ch4/Ch5 after empty SERP).'
        : 'Browser escalate OFF — Ch4/Ch5 skipped unless DeepResearch opts in.',
      enabled ? 'success' : 'warning',
    );
  } catch (error) {
    host.showStatus(
      `Failed to update browser escalate: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

function promptSearxngUrl(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new PlainTextInputDialogComponent({
      title: ttui('tui.settings.pane.search.searxngUrl'),
      subtitleLines: [
        'Self-hosted SearXNG base URL (JSON format).',
        'Example: https://searx.example.com',
      ],
      onDone: (result) => {
        dismissPickerDialog(host);
        if (result.kind !== 'ok') return;
        const url = result.value.trim();
        if (!isValidSearxngUrl(url)) {
          host.showStatus(ttui('tui.search.searxngUrl'), 'error');
          return;
        }
        void setSearxngUrl(host, url);
      },
    }),
    { label: 'SearXNG URL' },
  );
}

async function setSearxngUrl(host: SlashCommandHost, url: string): Promise<void> {
  try {
    await host.harness.setConfig(buildSearchSearxngUrlConfigPatch(url));
    host.showStatus(ttui('tui.search.searxngSaved', { url }), 'success');
  } catch (error) {
    host.showStatus(
      `Failed to save SearXNG URL: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

async function clearSearxngUrl(host: SlashCommandHost): Promise<void> {
  try {
    await host.harness.setConfig(buildSearchClearSearxngUrlConfigPatch());
    host.showStatus(
      'Cleared research.localSearch.searxngUrl (env SUPERLIORA_SEARXNG_URL may still apply).',
      'success',
    );
  } catch (error) {
    host.showStatus(
      `Failed to clear SearXNG URL: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

async function setPreferXai(host: SlashCommandHost, enabled: boolean): Promise<void> {
  try {
    await host.harness.setConfig(buildSearchPreferXaiConfigPatch(enabled));
    host.showStatus(
      enabled
        ? 'PreferXai ON — Grok Build web search before ResearchSearchEngine (when xAI is available).'
        : 'PreferXai OFF — ResearchSearchEngine / local cascade without PreferXai wrap.',
      enabled ? 'success' : 'warning',
    );
  } catch (error) {
    host.showStatus(
      `Failed to update PreferXai: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

async function setFreeFallback(host: SlashCommandHost, enabled: boolean): Promise<void> {
  try {
    await host.harness.setConfig(buildSearchFreeFallbackConfigPatch(enabled));
    host.showStatus(
      enabled
        ? 'Search free fallback ON ($0 DDG/local last resort).'
        : 'Search free fallback OFF — paid/meta channels only.',
      enabled ? 'success' : 'warning',
    );
  } catch (error) {
    host.showStatus(
      `Failed to update search config: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

async function showSearchStatusPanel(host: SlashCommandHost): Promise<void> {
  const status = detectSearchProviderEnvKeys();
  let config: Awaited<ReturnType<typeof host.harness.getConfig>> | undefined;
  try {
    config = await host.harness.getConfig({ reload: true });
  } catch {
    config = undefined;
  }
  const late = detectSearchLateChannelEnv(process.env, config);
  const cacheStatus = resolveLocalResearchCacheStatus(config);
  const freeFallback = resolveSearchFreeFallback(config);
  const strategy = resolveSearchStrategy(config);
  const browserEscalate = resolveSearchBrowserEscalate(config);
  const preferXai = resolveSearchPreferXai(config);
  let neverEmptyTelemetryLine: string | null = null;
  let localResearchCacheHitLine: string | null = null;
  let freeOnlyKpiLine: string | null = null;
  try {
    const sessionStatus = await host.requireSession().getStatus();
    const usage = sessionStatus.usage as import('../../../utils/search/search-never-empty-telemetry').UsageSearchNeverEmptyLike &
      import('../../../utils/search/local-research-cache-glance').UsageLocalResearchCacheLike;
    neverEmptyTelemetryLine = formatSearchNeverEmptyTelemetryGlance(usage);
    localResearchCacheHitLine = formatLocalResearchCacheHitGlance(usage);
    freeOnlyKpiLine = formatSearchFreeOnlyKpiSessionGlance(usage);
  } catch {
    /* no session — env/config only */
  }
  const lines = buildSearchSettingsStatusLines({
    status,
    late,
    cacheStatus,
    freeFallback,
    strategy,
    browserEscalate,
    preferXai,
    neverEmptyTelemetryLine,
    localResearchCacheHitLine,
    freeOnlyKpiLine,
    searchCascade: host.state.appState.searchCascade,
  });
  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ttui('tui.settings.pane.search.panelTitle'),
    enterBeatSeed: 'search',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
