/**
 * Settings → Providers & API — live login and model actions.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildProvidersApiSettingsLines,
  loadProvidersApiGlance,
  PROVIDERS_API_KEY_ENVS_TIP,
  PROVIDERS_LOGIN_TIP,
  resolveProvidersApiSessionGlance,
} from '../../../utils/provider/providers-api-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { ttui } from '#/tui/utils/tui-i18n';
import { handleLoginCommand } from '../../auth/login';
import { handleModelCommand } from '../model/model';
import {
  applyXaiGrokRouteToProvider,
  promptXaiGrokRoute,
  readXaiGrokRouteFromProvider,
  xaiGrokRouteStatusLabel,
} from '../../provider-connect/xai-grok-route';

import type { SlashCommandHost } from '../../hub/dispatch';

export { PROVIDERS_API_KEY_ENVS_TIP, PROVIDERS_LOGIN_TIP };

interface ProvidersSessionSnapshot {
  readonly session: ReturnType<typeof resolveProvidersApiSessionGlance>;
}

async function loadProvidersSessionSnapshot(
  host: SlashCommandHost,
): Promise<ProvidersSessionSnapshot> {
  const appState = host.state.appState;
  const catalogModels = Object.keys(appState.availableModels).length;
  const catalogProviders = Object.keys(appState.availableProviders ?? {}).length;

  let session = resolveProvidersApiSessionGlance({
    appStateModel: appState.model,
    availableModels: appState.availableModels,
    catalogModels,
    catalogProviders,
  });

  try {
    const live = host.requireSession();
    const status = await live.getStatus();

    session = resolveProvidersApiSessionGlance({
      statusModel: status.model,
      appStateModel: appState.model,
      availableModels: appState.availableModels,
      providerRouteStatus: status.providerRouteStatus,
      catalogModels,
      catalogProviders,
    });
  } catch {
    session = resolveProvidersApiSessionGlance({
      appStateModel: appState.model,
      availableModels: appState.availableModels,
      catalogModels,
      catalogProviders,
      sessionUnavailable: true,
    });
  }

  return { session };
}

export function showProvidersApiSettings(host: SlashCommandHost): void {
  void openProvidersApiSettings(host);
}

async function openProvidersApiSettings(host: SlashCommandHost): Promise<void> {
  let xaiConfigured = false;
  let xaiRouteLabel = ttui('tui.provider.xaiRouteBuild');
  try {
    const config = await host.harness.getConfig();
    const provider = config.providers['xai-grok'] as Record<string, unknown> | undefined;
    if (provider !== undefined) {
      xaiConfigured = true;
      xaiRouteLabel = xaiGrokRouteStatusLabel(readXaiGrokRouteFromProvider(provider));
    }
  } catch {
    // Menu still works without config; route switch hides itself.
  }

  const options: Array<{
    readonly value: string;
    readonly label: string;
    readonly description: string;
  }> = [
    {
      value: 'status',
      label: 'Providers status',
      description:
        'Credential posture · live session model/provider · API key env detection · catalog size.',
    },
    {
      value: 'login',
      label: 'Login / connect provider…',
      description: 'OAuth · catalog/custom provider · --add fallback slots.',
    },
    {
      value: 'model',
      label: 'Change model…',
      description: 'Open the model picker for the active session.',
    },
  ];
  if (xaiConfigured) {
    options.splice(2, 0, {
      value: 'xai-route',
      label: ttui('tui.provider.xaiRouteSwitchTitle'),
      description: `${ttui('tui.provider.xaiRouteSwitchDesc')} Now: ${xaiRouteLabel}.`,
    });
  }

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.providersApi.title'),
      searchable: true,
      options,
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showProvidersApiSettingsPanel(host);
          return;
        }
        if (value === 'login') {
          void handleLoginCommand(host);
          return;
        }
        if (value === 'xai-route') {
          void switchXaiGrokRoute(host);
          return;
        }
        if (value === 'model') {
          void handleModelCommand(host, '');
          return;
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.providersApi.title') },
  );
}

async function switchXaiGrokRoute(host: SlashCommandHost): Promise<void> {
  const config = await host.harness.getConfig();
  const existing = config.providers['xai-grok'] as Record<string, unknown> | undefined;
  if (existing === undefined) {
    host.showStatus(ttui('tui.provider.xaiRouteNotConfigured'));
    return;
  }
  const current = readXaiGrokRouteFromProvider(existing);
  const picked = await promptXaiGrokRoute(host, current);
  if (picked === undefined || picked === current) return;

  config.providers['xai-grok'] = applyXaiGrokRouteToProvider(existing, picked) as
    (typeof config.providers)[string];
  await host.harness.setConfig({ providers: config.providers });
  await host.authFlow.refreshConfigAfterLogin();
  host.showStatus(
    ttui('tui.provider.xaiRouteSelected', { route: xaiGrokRouteStatusLabel(picked) }),
  );
}

async function showProvidersApiSettingsPanel(host: SlashCommandHost): Promise<void> {
  const snapshot = await loadProvidersSessionSnapshot(host);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) =>
      [
        ...buildProvidersApiSettingsLines({
          ...loadProvidersApiGlance(process.env),
          session: snapshot.session,
        }),
      ],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.providersApi.panelTitle'),
    enterBeatSeed: 'providers-api',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
