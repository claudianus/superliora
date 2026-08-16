/**
 * Settings → Security — path sandbox picker + redaction / MCP glance (SSOT §9.2).
 * Path sandbox is a lexical file-tool guard — not OS isolation.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { loadNetworkGlance } from '../../../utils/network/network-glance';
import {
  buildSecuritySettingsLines,
  SECURITY_MCP_ALLOWLIST_TIP,
  SECURITY_NOT_OS_SANDBOX,
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

export {
  SECURITY_MCP_ALLOWLIST_TIP,
  SECURITY_NOT_OS_SANDBOX,
  SECURITY_REDACTION_TIP,
  SECURITY_SANDBOX_TIP,
};

const SANDBOX_OPTIONS: ReadonlyArray<{
  readonly value: SecuritySandboxProfile;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: 'off',
    label: '끔 (off)',
    description: '기본값 · 워크스페이스 밖 절대경로 허용 · 민감 경로는 계속 차단',
  },
  {
    value: 'workspace',
    label: '워크스페이스 (workspace)',
    description: '파일 도구가 워크스페이스(+ /add-dir) 안으로만 경로를 받음',
  },
  {
    value: 'read-only',
    label: '읽기 전용 (read-only)',
    description: '쓰기/편집 전부 차단 · 읽기는 워크스페이스 규칙',
  },
];

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
    // Product default is off when metadata has no key.
    if (resume !== undefined) {
      return 'off';
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

function currentSandboxMarker(profile: SecuritySandboxProfile | undefined, value: SecuritySandboxProfile): string {
  const effective = profile ?? 'off';
  return effective === value ? '● ' : '  ';
}

export function showSecuritySettings(host: SlashCommandHost): void {
  void (async () => {
    let current: SecuritySandboxProfile | undefined;
    try {
      current = resolveSandboxProfile(host.requireSession());
    } catch {
      current = undefined;
    }

    mountPickerDialog(
      host,
      new ChoicePickerComponent({
        title: ttui('tui.settings.pane.security.title'),
        hint: '↑↓ · Enter · Esc · path sandbox (not OS)',
        searchable: true,
        options: [
          {
            value: 'status',
            label: 'Security status',
            description:
              'Permission mode · path sandbox · network egress · redaction · MCP allowlist inventory.',
          },
          ...SANDBOX_OPTIONS.map((opt) => ({
            value: opt.value,
            label: `${currentSandboxMarker(current, opt.value)}${opt.label}`,
            description: opt.description,
          })),
          {
            value: 'tip-sandbox',
            label: 'About path sandbox',
            description: SECURITY_SANDBOX_TIP,
          },
          {
            value: 'tip-redaction',
            label: 'Secrets & redaction',
            description: SECURITY_REDACTION_TIP,
          },
          {
            value: 'tip-mcp',
            label: 'MCP tool allowlist',
            description: SECURITY_MCP_ALLOWLIST_TIP,
          },
        ],
        onSelect: (value) => {
          dismissPickerDialog(host);
          if (value === 'status') {
            void showSecuritySettingsPanel(host);
            return;
          }
          if (value === 'off' || value === 'workspace' || value === 'read-only') {
            void applySandboxProfile(host, value);
            return;
          }
          if (value === 'tip-sandbox') {
            host.showStatus(SECURITY_SANDBOX_TIP, 'info');
            return;
          }
          if (value === 'tip-redaction') {
            host.showStatus(SECURITY_REDACTION_TIP, 'info');
            return;
          }
          if (value === 'tip-mcp') {
            host.showStatus(SECURITY_MCP_ALLOWLIST_TIP, 'info');
            return;
          }
        },
        onCancel: () => {
          dismissPickerDialog(host);
        },
      }),
      { label: ttui('tui.settings.pane.security.title') },
    );
  })();
}

async function applySandboxProfile(
  host: SlashCommandHost,
  profile: SecuritySandboxProfile,
): Promise<void> {
  try {
    await host.harness.setConfig({ sandboxProfile: profile });
  } catch (error) {
    host.showStatus(
      `Failed to save sandboxProfile: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return;
  }

  try {
    const session = host.requireSession();
    if (typeof (session as { setSandboxProfile?: (p: SecuritySandboxProfile) => Promise<void> }).setSandboxProfile === 'function') {
      await (session as { setSandboxProfile: (p: SecuritySandboxProfile) => Promise<void> }).setSandboxProfile(
        profile,
      );
    }
  } catch {
    // Config saved; live session optional when no session is open.
  }

  const label =
    profile === 'off' ? '끔 (off)' : profile === 'workspace' ? '워크스페이스' : '읽기 전용';
  host.showStatus(
    `Path sandbox → ${label}. Not OS isolation. Applies to file tools from the next turn.`,
    profile === 'off' ? 'warning' : 'success',
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
