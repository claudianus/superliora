/**
 * Settings → Security — read-only sandbox / redaction / MCP glance (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { loadNetworkGlance } from '../../../utils/network/network-glance';
import {
  buildSecuritySettingsLines,
  SECURITY_MCP_ALLOWLIST_TIP,
  SECURITY_REDACTION_TIP,
  SECURITY_SANDBOX_TIP,
  type McpAllowlistSummary,
  type PermissionInterventionGlance,
  type SecurityGlanceInput,
  type SecuritySandboxProfile,
} from '../../../utils/security/security-glance';
import { readMcpJsonFile, resolveMcpJsonPaths, type McpServerFileConfig } from '#/utils/mcp/mcp-config-file';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export { SECURITY_MCP_ALLOWLIST_TIP, SECURITY_REDACTION_TIP, SECURITY_SANDBOX_TIP };

async function loadMcpAllowlistSummary(cwd: string): Promise<McpAllowlistSummary | undefined> {
  try {
    const paths = await resolveMcpJsonPaths(cwd);
    const merged = new Map<string, McpServerFileConfig>();
    for (const filePath of [paths.project, paths.projectRoot, paths.user]) {
      const servers = await readMcpJsonFile(filePath);
      for (const [name, config] of Object.entries(servers)) {
        merged.set(name, config);
      }
    }
    if (merged.size === 0) return { configured: 0, withEnabledTools: 0, withDisabledTools: 0 };
    let withEnabledTools = 0;
    let withDisabledTools = 0;
    for (const config of merged.values()) {
      if ((config.enabledTools?.length ?? 0) > 0) withEnabledTools += 1;
      if ((config.disabledTools?.length ?? 0) > 0) withDisabledTools += 1;
    }
    return {
      configured: merged.size,
      withEnabledTools,
      withDisabledTools,
    };
  } catch {
    return undefined;
  }
}

function resolveSandboxProfile(session: {
  getResumeState?: () =>
    | {
        readonly sessionMetadata?: {
          readonly custom?: Readonly<Record<string, unknown>>;
        };
      }
    | undefined;
}): SecuritySandboxProfile | undefined {
  try {
    const resume = session.getResumeState?.();
    const raw = resume?.sessionMetadata?.custom?.['sandboxProfile'];
    if (raw === 'off' || raw === 'workspace' || raw === 'read-only') {
      return raw;
    }
    if (resume !== undefined) {
      return 'workspace';
    }
  } catch {
    /* optional */
  }
  return undefined;
}

function permissionInterventionsFromStatus(status: {
  readonly pendingInterventions?: number;
  readonly staleInterventions?: number;
  readonly oldestInterventionAgeMs?: number;
}): PermissionInterventionGlance | undefined {
  if (
    status.pendingInterventions === undefined &&
    status.staleInterventions === undefined &&
    status.oldestInterventionAgeMs === undefined
  ) {
    return undefined;
  }
  return {
    pendingInterventions: status.pendingInterventions,
    staleInterventions: status.staleInterventions,
    oldestInterventionAgeMs: status.oldestInterventionAgeMs,
  };
}

async function loadSecurityGlance(host: SlashCommandHost): Promise<SecurityGlanceInput> {
  const permissionMode = host.state.appState.permissionMode ?? 'manual';
  const workDir = host.state.appState.workDir ?? process.cwd();
  const additionalDirs = host.state.appState.additionalDirs ?? [];
  const base: SecurityGlanceInput = {
    permissionMode,
    workDir,
    additionalDirs,
    network: loadNetworkGlance(process.env),
    mcpConfig: await loadMcpAllowlistSummary(workDir),
  };

  try {
    const session = host.requireSession();
    const [status, mcpLive] = await Promise.all([
      session.getStatus(),
      session.listMcpServers().catch(() => undefined),
    ]);
    return {
      ...base,
      permissionFromSession: status.permission,
      permissionInterventions: permissionInterventionsFromStatus(status),
      sandboxProfile: resolveSandboxProfile(session),
      mcpLive,
    };
  } catch {
    return base;
  }
}

export function showSecuritySettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.security.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Security status',
          description:
            'Permission mode · path sandbox · network egress · redaction · MCP allowlist inventory.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showSecuritySettingsPanel(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.security.title') },
  );
}

async function showSecuritySettingsPanel(host: SlashCommandHost): Promise<void> {
  const lines = buildSecuritySettingsLines(await loadSecurityGlance(host));

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.security.panelTitle'),
    enterBeatSeed: 'security',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
