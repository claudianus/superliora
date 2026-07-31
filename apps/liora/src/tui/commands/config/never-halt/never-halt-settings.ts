/**
 * Settings → Never-Halt — resilience contract glance (Sovereign Reform W14).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { resolveOAuthPoolGlance } from '../../../utils/never-halt/auth-glance';
import { resolveNeverHaltBreakerLines } from '../../../utils/never-halt/breaker-glance';
import {
  buildNeverHaltSettingsLines,
  NEVER_HALT_BREAKER_TIP,
  NEVER_HALT_INTERVENTION_TIP,
  NEVER_HALT_OAUTH_TIP,
  NEVER_HALT_SEARCH_FALLBACK_TIP,
} from '../../../utils/never-halt/never-halt-glance';
import { formatInterventionQueueSettingsLine } from '../../../utils/never-halt/intervention-glance';
import { activeRuntimeDegraded } from '../../../utils/never-halt/runtime-degraded';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { detectSearchProviderEnvKeys } from '../search/search-status';

export {
  NEVER_HALT_BREAKER_TIP,
  NEVER_HALT_INTERVENTION_TIP,
  NEVER_HALT_OAUTH_TIP,
  NEVER_HALT_SEARCH_FALLBACK_TIP,
};

export function showNeverHaltSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Never-Halt',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Never-Halt status',
          description:
            'Live degradation · search fallback · OAuth pool · intervention queue · circuit breakers.',
        },
        {
          value: 'tip-search-fallback',
          label: 'Search fallback tip',
          description:
            'Free DDG/local fallback · research.search.freeFallback · Settings → Search toggle.',
        },
        {
          value: 'tip-oauth',
          label: 'OAuth refresh tip',
          description:
            'Proactive ensureFresh poll · multi-account pool · /login --add · Settings → Accounts.',
        },
        {
          value: 'tip-intervention',
          label: 'Intervention queue tip',
          description:
            'Non-blocking approvals · Fleet continues · parallel tools · SUPERLIORA_PERMISSION_AUTO_EXPIRE_MS.',
        },
        {
          value: 'tip-breaker',
          label: 'Circuit breaker tip',
          description:
            'Per-provider 5xx/429 trips · fallbackModels routing · half-open probe · runtime.degraded.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showNeverHaltSettingsPanel(host);
          return;
        }
        if (value === 'tip-search-fallback') {
          host.showStatus(NEVER_HALT_SEARCH_FALLBACK_TIP, 'info');
          return;
        }
        if (value === 'tip-oauth') {
          host.showStatus(NEVER_HALT_OAUTH_TIP, 'info');
          return;
        }
        if (value === 'tip-intervention') {
          host.showStatus(NEVER_HALT_INTERVENTION_TIP, 'info');
          return;
        }
        if (value === 'tip-breaker') {
          host.showStatus(NEVER_HALT_BREAKER_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Never-Halt' },
  );
}

async function loadNeverHaltGlance(host: SlashCommandHost) {
  const search = detectSearchProviderEnvKeys();
  const degraded = activeRuntimeDegraded(host.state.appState.runtimeDegraded);

  let breakerLines = resolveNeverHaltBreakerLines({
    appStateBreakers: host.state.appState.circuitBreakers,
    degraded,
  });
  let oauthPoolGlance = resolveOAuthPoolGlance(
    undefined,
    host.state.appState.availableProviders,
    host.state.appState.model.trim().length > 0
      ? host.state.appState.availableModels[host.state.appState.model]?.provider
      : undefined,
  );
  let interventionQueueLine = formatInterventionQueueSettingsLine({
    sessionUnavailable: true,
  });

  try {
    const status = await host.requireSession().getStatus();
    breakerLines = resolveNeverHaltBreakerLines({
      appStateBreakers: host.state.appState.circuitBreakers,
      statusBreakers: status.circuitBreakers,
      degraded,
    });
    oauthPoolGlance = resolveOAuthPoolGlance(
      status,
      host.state.appState.availableProviders,
      host.state.appState.model.trim().length > 0
        ? host.state.appState.availableModels[host.state.appState.model]?.provider
        : undefined,
    );
    interventionQueueLine = formatInterventionQueueSettingsLine({
      pendingInterventions: status.pendingInterventions,
      staleInterventions: status.staleInterventions,
      oldestInterventionAgeMs: status.oldestInterventionAgeMs,
    });
  } catch {
    /* keep degraded-only fallback */
  }

  return {
    search: { configuredPaidChannels: search.configured },
    oauthPoolGlance,
    interventionQueueLine,
    breakerLines,
    degraded,
  };
}

async function showNeverHaltSettingsPanel(host: SlashCommandHost): Promise<void> {
  const lines = buildNeverHaltSettingsLines(await loadNeverHaltGlance(host));

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Never-Halt ',
    enterBeatSeed: 'never-halt',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
