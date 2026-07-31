/**
 * Settings → Search — channel health / key detection / free-fallback / strategy / Ch4–5.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
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
  buildSearchFreeFallbackConfigPatch,
  buildSearchSettingsStatusLines,
  buildSearchStrategyConfigPatch,
  detectSearchLateChannelEnv,
  detectSearchProviderEnvKeys,
  resolveLocalResearchCacheStatus,
  resolveSearchBrowserEscalate,
  resolveSearchFreeFallback,
  resolveSearchStrategy,
  SEARCH_ROUTING_STRATEGY_OPTIONS,
  type SearchRoutingStrategySetting,
} from './search-status';

export function showSearchSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Search / Deep Research',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
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
      title: 'Search routing strategy',
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
    host.showStatus(`Search strategy → ${strategy}.`, 'success');
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
    neverEmptyTelemetryLine,
    localResearchCacheHitLine,
    freeOnlyKpiLine,
    searchCascade: host.state.appState.searchCascade,
  });
  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ' Search ',
    enterBeatSeed: 'search',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
