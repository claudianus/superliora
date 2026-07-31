/**
 * TUI MCP manage control plane — toggle / install / remove + hot reload.
 */

import type { McpServerInfo } from '@superliora/sdk';

import { PlainTextInputDialogComponent } from '../../components/dialogs/shared/plain-text-input-dialog';
import { ChoicePickerComponent, type ChoiceOption } from '../../components/dialogs/picker/choice-picker';
import { formatErrorMessage } from '../../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import {
  findMcpServerScope,
  httpConfig,
  removeMcpServer,
  setMcpServerEnabled,
  stdioConfig,
  upsertMcpServer,
  type McpConfigScope,
  type McpServerFileConfig,
} from '#/utils/mcp/mcp-config-file';
import { getDataDir } from '#/utils/paths';

import { extensionsReloadAppStatePatch } from '#/tui/components/chrome/footer/footer-badges';

import type { SlashCommandHost } from '../hub/dispatch';
import { showMcpServers } from '../info/info';

type ManageAction =
  | 'status'
  | 'toggle'
  | 'add-stdio'
  | 'add-http'
  | 'remove'
  | 'plugins'
  | 'reload';

export async function showMcpManagePanel(host: SlashCommandHost): Promise<void> {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'MCP servers',
      hint: '↑↓ · Enter · Esc · Claude-compatible mcp.json',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Status',
          description: 'Live connection status for configured servers.',
        },
        {
          value: 'toggle',
          label: 'Enable / disable',
          description: 'Toggle a server without editing JSON by hand.',
        },
        {
          value: 'add-stdio',
          label: 'Install (stdio)',
          description: 'Add a local command server to user mcp.json.',
        },
        {
          value: 'add-http',
          label: 'Install (HTTP URL)',
          description: 'Add a remote MCP endpoint to user mcp.json.',
        },
        {
          value: 'remove',
          label: 'Remove',
          description: 'Delete a server entry from its config scope.',
        },
        {
          value: 'plugins',
          label: 'Plugin MCP…',
          description: 'Manage MCP servers declared by installed plugins.',
        },
        {
          value: 'reload',
          label: 'Reload session',
          description: 'Apply mcp.json changes to the current session.',
        },
      ] satisfies ChoiceOption[],
      onSelect: (value) => {
        void handleManageAction(host, value as ManageAction);
      },
      onCancel: () => dismissPickerDialog(host),
    }),
    { label: 'MCP' },
  );
}

async function handleManageAction(host: SlashCommandHost, action: ManageAction): Promise<void> {
  dismissPickerDialog(host);
  switch (action) {
    case 'status':
      await showMcpServers(host);
      return;
    case 'toggle':
      await showServerPicker(host, 'toggle');
      return;
    case 'remove':
      await showServerPicker(host, 'remove');
      return;
    case 'add-stdio':
      promptText(host, 'stdio server name', ['Letters/digits recommended', 'e.g. filesystem'], (name) => {
        promptText(
          host,
          'stdio command line',
          ['Full command with args', 'e.g. npx -y @modelcontextprotocol/server-filesystem .'],
          (commandLine) => {
            void installStdio(host, name, commandLine);
          },
        );
      });
      return;
    case 'add-http':
      promptText(host, 'HTTP server name', ['e.g. remote-tools'], (name) => {
        promptText(host, 'HTTP MCP URL', ['https://example.com/mcp'], (url) => {
          void installHttp(host, name, url);
        });
      });
      return;
    case 'plugins': {
      const { handlePluginsCommand } = await import('../plugins/plugins');
      await handlePluginsCommand(host, 'mcp');
      return;
    }
    case 'reload':
      await reloadSessionQuiet(host, 'MCP config reloaded.');
      return;
  }
}

async function showServerPicker(host: SlashCommandHost, mode: 'toggle' | 'remove'): Promise<void> {
  let servers: readonly McpServerInfo[];
  try {
    servers = await host.requireSession().listMcpServers();
  } catch (error) {
    host.showError(`Failed to load MCP servers: ${formatErrorMessage(error)}`);
    return;
  }
  if (servers.length === 0) {
    host.showStatus('No MCP servers configured. Use Install to add one.');
    return;
  }

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: mode === 'toggle' ? 'Toggle MCP server' : 'Remove MCP server',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: servers.map((server) => ({
        value: server.name,
        label: server.name,
        description: `${server.transport} · ${server.status}${server.toolCount > 0 ? ` · ${String(server.toolCount)} tools` : ''}`,
        tone: mode === 'remove' ? ('danger' as const) : undefined,
      })),
      onSelect: (name) => {
        dismissPickerDialog(host);
        if (mode === 'toggle') void toggleServer(host, name);
        else void confirmRemove(host, name);
      },
      onCancel: () => dismissPickerDialog(host),
    }),
    { label: 'MCP' },
  );
}

async function toggleServer(host: SlashCommandHost, name: string): Promise<void> {
  const session = host.requireSession();
  const cwd = session.workDir;
  const homeDir = getDataDir();
  try {
    const servers = await session.listMcpServers();
    const current = servers.find((s) => s.name === name);
    const enable = current?.status === 'disabled';
    const scope = await findMcpServerScope(cwd, name, homeDir);
    if (scope === undefined) {
      host.showError(
        `Server "${name}" is not in mcp.json (likely plugin MCP). Use Plugin MCP… or /plugins mcp.`,
      );
      return;
    }
    const result = await setMcpServerEnabled(cwd, scope, name, enable, homeDir);
    if (!result.found) {
      host.showError(`Could not update ${name} in ${scope}.`);
      return;
    }
    await reloadSessionQuiet(
      host,
      `${enable ? 'Enabled' : 'Disabled'} ${name} (${scope}) · session reloaded.`,
    );
  } catch (error) {
    host.showError(`MCP toggle failed: ${formatErrorMessage(error)}`);
  }
}

function confirmRemove(host: SlashCommandHost, name: string): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: `Remove ${name}?`,
      hint: 'This deletes the mcp.json entry',
      options: [
        { value: 'yes', label: 'Remove', description: 'Delete from config and reload.', tone: 'danger' },
        { value: 'no', label: 'Cancel', description: 'Keep the server.' },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'yes') void removeServer(host, name);
      },
      onCancel: () => dismissPickerDialog(host),
    }),
    { label: 'MCP' },
  );
}

async function removeServer(host: SlashCommandHost, name: string): Promise<void> {
  const session = host.requireSession();
  const cwd = session.workDir;
  const homeDir = getDataDir();
  try {
    const scope = await findMcpServerScope(cwd, name, homeDir);
    if (scope === undefined) {
      host.showError(`Server "${name}" not found in mcp.json scopes.`);
      return;
    }
    const result = await removeMcpServer(cwd, scope, name, homeDir);
    if (!result.found) {
      host.showError(`Could not remove ${name}.`);
      return;
    }
    await reloadSessionQuiet(host, `Removed ${name} from ${scope} · session reloaded.`);
  } catch (error) {
    host.showError(`MCP remove failed: ${formatErrorMessage(error)}`);
  }
}

async function installStdio(host: SlashCommandHost, name: string, commandLine: string): Promise<void> {
  const parts = commandLine.trim().split(/\s+/).filter((p) => p.length > 0);
  const command = parts[0];
  if (command === undefined) {
    host.showError('Command is required.');
    return;
  }
  await installConfig(host, name, stdioConfig(command, parts.slice(1)), 'user');
}

async function installHttp(host: SlashCommandHost, name: string, url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    host.showError('Invalid URL.');
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    host.showError('URL must be http(s).');
    return;
  }
  await installConfig(host, name, httpConfig(parsed.toString()), 'user');
}

async function installConfig(
  host: SlashCommandHost,
  name: string,
  config: McpServerFileConfig,
  scope: McpConfigScope,
): Promise<void> {
  const session = host.requireSession();
  try {
    const path = await upsertMcpServer(session.workDir, scope, name, config, getDataDir());
    await reloadSessionQuiet(host, `Installed ${name} → ${path} · session reloaded.`);
  } catch (error) {
    host.showError(`MCP install failed: ${formatErrorMessage(error)}`);
  }
}

async function reloadSessionQuiet(host: SlashCommandHost, okMessage: string): Promise<void> {
  try {
    await host.requireSession().reloadSession({ forcePluginSessionStartReminder: true });
    host.setAppState(extensionsReloadAppStatePatch());
    host.showStatus(okMessage);
  } catch (error) {
    host.showError(`Reload failed (config saved): ${formatErrorMessage(error)}`);
  }
}

function promptText(
  host: SlashCommandHost,
  title: string,
  subtitleLines: readonly string[],
  onOk: (value: string) => void,
): void {
  mountPickerDialog(
    host,
    new PlainTextInputDialogComponent({
      title,
      subtitleLines,
      onDone: (result) => {
        dismissPickerDialog(host);
        if (result.kind === 'ok') onOk(result.value);
      },
    }),
    { label: title },
  );
}
