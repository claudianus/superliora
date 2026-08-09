/**
 * Settings → Hooks — read-only Pre/Post/Stop tips (SSOT §9.2).
 */

import { loadRuntimeConfigSafe, resolveConfigPath, resolveLioraHome } from '@superliora/sdk';

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildHooksSettingsLines,
  HOOKS_ENABLE_TIP,
  HOOKS_POST_TOOL_USE_TIP,
  HOOKS_PRE_TOOL_USE_TIP,
  HOOKS_STOP_TIP,
} from '../../../utils/hooks/hooks-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { showExtensionsHub } from '../extensions/extensions-hub';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export { HOOKS_ENABLE_TIP, HOOKS_POST_TOOL_USE_TIP, HOOKS_PRE_TOOL_USE_TIP, HOOKS_STOP_TIP };

async function loadHooksGlance(host: SlashCommandHost): Promise<{
  readonly registry?: {
    readonly totalCount: number;
    readonly events: Readonly<Record<string, number>>;
  };
  readonly pluginHookCount?: number;
  readonly enabledPluginCount?: number;
  readonly configPath: string;
}> {
  let configPath = '(unknown)';
  try {
    const homeDir = host.harness.homeDir ?? resolveLioraHome();
    configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });
    loadRuntimeConfigSafe(configPath);
  } catch {
    /* read-only */
  }

  try {
    const session = host.requireSession();
    const [registry, plugins] = await Promise.all([
      session.getHookRegistry(),
      session.listPlugins(),
    ]);
    const enabled = plugins.filter((p) => p.enabled);
    const hookCount = enabled.reduce((sum, p) => sum + (p.hookCount ?? 0), 0);
    return {
      registry,
      pluginHookCount: hookCount,
      enabledPluginCount: enabled.length,
      configPath,
    };
  } catch {
    return { configPath };
  }
}

export function showHooksSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.hooks.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Hooks status',
          description:
            'Live HookEngine registry · plugin hook counts · config.toml [[hooks]] path.',
        },
        {
          value: 'extensions',
          label: 'Manage extensions / hooks…',
          description: 'Plugin hooks.json · /extensions modal · enable/disable packs.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showHooksSettingsPanel(host);
          return;
        }
        if (value === 'extensions') {
          showExtensionsHub(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.hooks.title') },
  );
}

async function showHooksSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadHooksGlance(host);
  const lines = buildHooksSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.hooks.panelTitle'),
    enterBeatSeed: 'hooks',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
