/**
 * Settings → MCP — live listMcpServers glance + manage entry (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { readMcpJsonFile, resolveMcpJsonPaths } from '#/utils/mcp/mcp-config-file';
import { getDataDir } from '#/utils/paths';
import {
  buildMcpSettingsLines,
  MCP_ALLOWLIST_TIP,
  MCP_CONFIG_SCOPES_TIP,
  MCP_OAUTH_TIP,
  type McpConfigGlance,
  type McpGlanceInput,
} from '../../../utils/mcp/mcp-glance';
import { formatErrorMessage } from '../../../utils/event-payload';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { showMcpManagePanel } from './mcp-manage';

export { MCP_ALLOWLIST_TIP, MCP_CONFIG_SCOPES_TIP, MCP_OAUTH_TIP };

async function loadMcpConfigGlance(workDir: string): Promise<McpConfigGlance | undefined> {
  try {
    const paths = await resolveMcpJsonPaths(workDir, getDataDir());
    const merged = new Set<string>();
    const scopePaths: string[] = [];
    for (const [scope, filePath] of [
      ['project', paths.project] as const,
      ['projectRoot', paths.projectRoot] as const,
      ['user', paths.user] as const,
    ]) {
      const servers = await readMcpJsonFile(filePath);
      const count = Object.keys(servers).length;
      if (count > 0) {
        scopePaths.push(`${scope}: ${filePath} (${String(count)})`);
      }
      for (const name of Object.keys(servers)) {
        merged.add(name);
      }
    }
    return { configured: merged.size, paths: scopePaths };
  } catch {
    return undefined;
  }
}

async function loadMcpGlance(host: SlashCommandHost): Promise<McpGlanceInput> {
  const workDir = host.state.appState.workDir ?? process.cwd();
  const base: McpGlanceInput = {
    config: await loadMcpConfigGlance(workDir),
  };

  try {
    const live = await host.requireSession().listMcpServers();
    return { ...base, live };
  } catch (error) {
    const message = formatErrorMessage(error);
    if (/session/i.test(message)) {
      return base;
    }
    return { ...base, loadError: message };
  }
}

export function showMcpSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'MCP servers',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'MCP status',
          description:
            'Live session server count · connection states · mcp.json scope inventory.',
        },
        {
          value: 'manage',
          label: 'Manage servers',
          description:
            'Install/toggle/reload · same leaf as Extensions → Manage → MCP · /mcp.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showMcpStatusPanel(host);
          return;
        }
        if (value === 'manage') {
          void showMcpManagePanel(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'MCP' },
  );
}

async function showMcpStatusPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadMcpGlance(host);
  const lines = buildMcpSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' MCP ',
    enterBeatSeed: 'mcp-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
