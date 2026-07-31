/**
 * Settings → MCP — live listMcpServers glance + manage entry (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { readMcpJsonFile, resolveMcpJsonPaths } from '#/utils/mcp/mcp-config-file';
import { getDataDir } from '#/utils/paths';
import {
  buildMcpSettingsLines,
  type McpConfigGlance,
  type McpGlanceInput,
} from '../../utils/mcp/mcp-glance';
import { formatErrorMessage } from '../../utils/event-payload';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../hub/dispatch';
import { showMcpManagePanel } from './mcp-manage';

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
      hint: '↑↓ · Enter · Esc · Claude-compatible mcp.json',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Live status',
          description: 'Session server count, connection states, config scopes.',
        },
        {
          value: 'manage',
          label: 'Manage servers',
          description: 'Install, toggle, remove, reload MCP.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showMcpStatusPanel(host);
          return;
        }
        void showMcpManagePanel(host);
      },
      onCancel: () => dismissPickerDialog(host),
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
    requestRender: () => requestTUILayoutRender(host.state),
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
