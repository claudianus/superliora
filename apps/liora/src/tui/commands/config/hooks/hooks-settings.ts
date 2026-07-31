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

import type { SlashCommandHost } from '../../hub/dispatch';

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
      title: 'Hooks',
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
          value: 'tip-pre-tool-use',
          label: 'PreToolUse tip',
          description: 'Gate destructive git/rm, .env writes, secret paths before tools run.',
        },
        {
          value: 'tip-post-tool-use',
          label: 'PostToolUse tip',
          description: 'Audit, format, telemetry · RunProjectChecks after Edit/Write.',
        },
        {
          value: 'tip-stop',
          label: 'Stop / lifecycle tip',
          description: 'Session wind-down · teammate idle · SessionStart / UserPromptSubmit.',
        },
        {
          value: 'tip-enable',
          label: 'Enable hooks tip',
          description: 'config.toml [[hooks]] · plugin hooks.json · /ext hooks audit.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showHooksSettingsPanel(host);
          return;
        }
        if (value === 'tip-pre-tool-use') {
          host.showStatus(HOOKS_PRE_TOOL_USE_TIP, 'info');
          return;
        }
        if (value === 'tip-post-tool-use') {
          host.showStatus(HOOKS_POST_TOOL_USE_TIP, 'info');
          return;
        }
        if (value === 'tip-stop') {
          host.showStatus(HOOKS_STOP_TIP, 'info');
          return;
        }
        if (value === 'tip-enable') {
          host.showStatus(HOOKS_ENABLE_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Hooks' },
  );
}

async function showHooksSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadHooksGlance(host);
  const lines = buildHooksSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Hooks ',
    enterBeatSeed: 'hooks',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
