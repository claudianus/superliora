/**
 * Settings → Search — channel health / key detection / free-fallback toggle.
 */

import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../hub/dispatch';
import { formatLocalResearchCacheHitGlance } from '../../utils/search/local-research-cache-glance';
import { formatSearchFreeOnlyKpiSessionGlance } from '../../utils/search/search-free-only-kpi';
import { formatSearchNeverEmptyTelemetryGlance } from '../../utils/search/search-never-empty-telemetry';
import {
  buildSearchFreeFallbackConfigPatch,
  buildSearchSettingsStatusLines,
  detectSearchLateChannelEnv,
  detectSearchProviderEnvKeys,
  resolveLocalResearchCacheStatus,
  resolveSearchFreeFallback,
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
            'Escalate ladder Ch1–5 · never-empty soft-fail · cascade footer badge.',
        },
        {
          value: 'free-on',
          label: 'Free fallback ON (Never-Empty default)',
          description:
            'harness.setConfig → research.search.freeFallback = true · DDG/local last resort.',
        },
        {
          value: 'free-off',
          label: 'Free fallback OFF (paid/meta only)',
          description:
            'harness.setConfig → research.search.freeFallback = false · avoid for unattended runs.',
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
        if (value === 'free-on') {
          void setFreeFallback(host, true);
          return;
        }
        if (value === 'free-off') {
          void setFreeFallback(host, false);
        }
      },
      onCancel: () =>{  dismissPickerDialog(host); },
    }),
    { label: 'Search' },
  );
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
  let neverEmptyTelemetryLine: string | null = null;
  let localResearchCacheHitLine: string | null = null;
  let freeOnlyKpiLine: string | null = null;
  try {
    const sessionStatus = await host.requireSession().getStatus();
    const usage = sessionStatus.usage as import('../../utils/search/search-never-empty-telemetry').UsageSearchNeverEmptyLike &
      import('../../utils/search/local-research-cache-glance').UsageLocalResearchCacheLike;
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
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
