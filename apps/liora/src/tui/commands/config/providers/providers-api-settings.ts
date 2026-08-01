/**
 * Settings → Providers & API — live login / model / search actions (SSOT §9.2).
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
import { handleLoginCommand } from '../../auth/login';
import { handleModelCommand } from '../model/model';
import { showSearchSettings } from '../search/search-settings';
import { SEARCH_PREFER_XAI_TIP } from '../search/search-status';

import type { SlashCommandHost } from '../../hub/dispatch';

export { PROVIDERS_API_KEY_ENVS_TIP, PROVIDERS_LOGIN_TIP, SEARCH_PREFER_XAI_TIP };

interface ProvidersSessionSnapshot {
  readonly webSearchActive?: boolean;
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
  let webSearchActive: boolean | undefined;

  try {
    const live = host.requireSession();
    const [status, tools] = await Promise.all([
      live.getStatus(),
      typeof live.getTools === 'function' ? live.getTools() : Promise.resolve([]),
    ]);

    session = resolveProvidersApiSessionGlance({
      statusModel: status.model,
      appStateModel: appState.model,
      availableModels: appState.availableModels,
      providerRouteStatus: status.providerRouteStatus,
      catalogModels,
      catalogProviders,
    });
    webSearchActive = tools.some((tool) => tool.name === 'WebSearch' && tool.active);
  } catch {
    session = resolveProvidersApiSessionGlance({
      appStateModel: appState.model,
      availableModels: appState.availableModels,
      catalogModels,
      catalogProviders,
      sessionUnavailable: true,
    });
  }

  return { webSearchActive, session };
}

export function showProvidersApiSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Providers & API',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
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
        {
          value: 'search',
          label: 'Search channels…',
          description: 'Prefer xAI · browser · free fallback · strategy pickers.',
        },
        {
          value: 'tip-login',
          label: '/login tip',
          description:
            'OAuth · catalog/custom provider · --add fallback slots · Settings → Accounts.',
        },
        {
          value: 'tip-api-keys',
          label: 'API key env tip',
          description:
            'KIMI_API_KEY · ANTHROPIC · OPENAI · GOOGLE · XAI · config.toml env:VAR.',
        },
        {
          value: 'tip-prefer-xai',
          label: 'PreferXai tip',
          description:
            'XAI_API_KEY or /login xAI → Grok Build web search before ResearchSearchEngine.',
        },
      ],
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
        if (value === 'model') {
          void handleModelCommand(host, '');
          return;
        }
        if (value === 'search') {
          showSearchSettings(host);
          return;
        }
        if (value === 'tip-login') {
          host.showStatus(PROVIDERS_LOGIN_TIP, 'info');
          return;
        }
        if (value === 'tip-api-keys') {
          host.showStatus(PROVIDERS_API_KEY_ENVS_TIP, 'info');
          return;
        }
        if (value === 'tip-prefer-xai') {
          host.showStatus(SEARCH_PREFER_XAI_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Providers & API' },
  );
}

async function showProvidersApiSettingsPanel(host: SlashCommandHost): Promise<void> {
  const snapshot = await loadProvidersSessionSnapshot(host);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) =>
      [
        ...buildProvidersApiSettingsLines({
          ...loadProvidersApiGlance(process.env),
          webSearchActive: snapshot.webSearchActive,
          session: snapshot.session,
        }),
      ],
    borderToken: 'primary',
    title: ' Providers ',
    enterBeatSeed: 'providers-api',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
