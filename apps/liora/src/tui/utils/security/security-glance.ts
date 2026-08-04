/**
 * Security settings glance — read-only inventory for SSOT §9.2.
 * No fake toggles; surfaces live permission/workspace/MCP facts + navigation hints.
 */

import type { PermissionMode } from '@superliora/sdk';
import {
  REDTEAM_SOFT_SUITE_TIP,
  redactSecretsStatusLine,
} from '@superliora/sdk';

import {
  formatInterventionQueueOpsLine,
} from '../never-halt/intervention-glance';
import type { NetworkGlanceInput } from '../network/network-glance';

export type SecuritySandboxProfile = 'off' | 'workspace' | 'read-only';

export interface McpAllowlistSummary {
  readonly configured: number;
  readonly withEnabledTools: number;
  readonly withDisabledTools: number;
}

export interface PermissionInterventionGlance {
  readonly pendingInterventions?: number;
  readonly staleInterventions?: number;
  readonly oldestInterventionAgeMs?: number;
}

export interface SecurityGlanceInput {
  readonly permissionMode: PermissionMode;
  readonly permissionFromSession?: PermissionMode | undefined;
  readonly permissionInterventions?: PermissionInterventionGlance | undefined;
  readonly sandboxProfile?: SecuritySandboxProfile | undefined;
  readonly workDir: string;
  readonly additionalDirs: readonly string[];
  readonly network?: NetworkGlanceInput | undefined;
  readonly mcpLive?: ReadonlyArray<{ readonly status: string }> | undefined;
  readonly mcpConfig?: McpAllowlistSummary | undefined;
}

const SANDBOX_PROFILE_TIPS: Readonly<Record<SecuritySandboxProfile, string>> = {
  workspace:
    'Read/Write/Edit/Glob/Grep stay inside workspace roots; absolute paths outside are denied.',
  'read-only': 'All writes blocked; reads follow workspace root rules.',
  off: 'Legacy profile — absolute paths outside roots are allowed (sensitive paths still blocked).',
};

/** Compact path-sandbox tip — Settings → Security picker + status panel. */
export const SECURITY_SANDBOX_TIP =
  'Sandbox profiles off | workspace | read-only — workspace denies paths outside roots; read-only blocks writes; off allows legacy absolute paths (sensitive paths still blocked). Set via session metadata custom.sandboxProfile · /add-dir for extra roots.';

/** Compact secrets/redaction tip — agent-core SSOT. */
export const SECURITY_REDACTION_TIP =
  `${redactSecretsStatusLine()} · ${REDTEAM_SOFT_SUITE_TIP} · Bash hard-blocks cat/source/base64 of secrets · Glob/Grep filter .env even with includeIgnored · never commit keys — use env vars or Settings → Accounts.`;

/** Compact MCP tool-allowlist tip — mcp.json scopes. */
export const SECURITY_MCP_ALLOWLIST_TIP =
  'MCP tool allowlist: enabledTools / disabledTools per server in mcp.json — empty enabledTools = all tools; disabledTools wins on conflict · project + user scopes merge · Settings → MCP to install, toggle, reload.';

export function formatPermissionModeLine(
  mode: PermissionMode,
  sessionMode?: PermissionMode | undefined,
  interventions?: PermissionInterventionGlance | undefined,
): string {
  const lines: string[] = [];
  if (sessionMode !== undefined && sessionMode !== mode) {
    lines.push(`Current: ${mode} (TUI) · session reports ${sessionMode}`);
  } else if (sessionMode !== undefined) {
    lines.push(`Current: ${mode} · live session confirms · /permission to change`);
  } else {
    lines.push(`Current: ${mode} · footer badge · /permission to change`);
  }

  const queueLine = formatInterventionQueueOpsLine(
    interventions?.pendingInterventions ?? 0,
    interventions?.oldestInterventionAgeMs,
    interventions?.staleInterventions ?? 0,
  );
  if (queueLine !== null) {
    lines.push(queueLine);
  }

  return lines.join('\n');
}

export function formatSandboxProfileLine(profile: SecuritySandboxProfile | undefined): string {
  if (profile === undefined) {
    return 'Sandbox profile: workspace (engine default when session starts — metadata.custom.sandboxProfile)';
  }
  return `Sandbox profile: ${profile} — ${SANDBOX_PROFILE_TIPS[profile]}`;
}

export function formatWorkspaceSandboxLines(
  workDir: string,
  additionalDirs: readonly string[],
  sandboxProfile?: SecuritySandboxProfile | undefined,
): readonly string[] {
  const lines = [`Workspace root: ${workDir}`];
  if (additionalDirs.length > 0) {
    lines.push(`Extra roots (+${String(additionalDirs.length)}): ${additionalDirs.join(', ')}`);
  }
  lines.push(formatSandboxProfileLine(sandboxProfile));
  lines.push('Set via session metadata custom.sandboxProfile (off | workspace | read-only).');
  lines.push('Extra roots: /add-dir · absolute paths outside roots denied in workspace profile.');
  return lines;
}

export function formatNetworkEgressLines(network: NetworkGlanceInput | undefined): readonly string[] {
  if (network === undefined) {
    return ['Outbound: process env read at CLI startup — set HTTP_PROXY/HTTPS_PROXY before launching liora.'];
  }
  if (!network.proxyActive) {
    return ['Outbound: direct — no HTTP_PROXY/HTTPS_PROXY/ALL_PROXY detected in process env.'];
  }
  const lines = ['Outbound: proxy ACTIVE (installed at CLI startup via global dispatcher).'];
  if (network.httpsProxy !== undefined) {
    lines.push(`HTTPS_PROXY=${network.httpsProxy}`);
  } else if (network.httpProxy !== undefined) {
    lines.push(`HTTP_PROXY=${network.httpProxy}`);
  } else if (network.allProxy !== undefined) {
    lines.push(`ALL_PROXY=${network.allProxy}`);
  }
  if (network.socksConfigured) {
    lines.push('SOCKS detected — MCP stdio + local loopback stay direct.');
  }
  lines.push('Full env glance: Settings → Network / Proxy.');
  return lines;
}

export function formatMcpAllowlistLines(
  live: ReadonlyArray<{ readonly status: string }> | undefined,
  config: McpAllowlistSummary | undefined,
): readonly string[] {
  const lines: string[] = [];
  if (live !== undefined) {
    const connected = live.filter((s) => s.status === 'connected').length;
    const disabled = live.filter((s) => s.status === 'disabled').length;
    lines.push(
      `Live session: ${String(live.length)} server(s) · ${String(connected)} connected${
        disabled > 0 ? ` · ${String(disabled)} disabled` : ''
      }`,
    );
  } else {
    lines.push('Live session: (no active session — start one to inspect MCP status)');
  }
  if (config !== undefined && config.configured > 0) {
    const parts = [`${String(config.configured)} in mcp.json`];
    if (config.withEnabledTools > 0) {
      parts.push(`${String(config.withEnabledTools)} with enabledTools allowlist`);
    }
    if (config.withDisabledTools > 0) {
      parts.push(`${String(config.withDisabledTools)} with disabledTools`);
    }
    lines.push(`Config scopes: ${parts.join(' · ')}`);
  } else {
    lines.push('Config scopes: no mcp.json entries yet — add via Settings → MCP');
  }
  lines.push('Per-server tool allowlist: enabledTools / disabledTools in mcp.json');
  lines.push('Empty enabledTools = all tools exposed; disabledTools wins when both set.');
  lines.push('Scopes merge project → projectRoot → user — later files override name collisions.');
  return lines;
}

/** PostToolUse verification sensors (W6 — read-only tips). */
export function securitySensorLines(): readonly string[] {
  return [
    'PostToolUse (Edit/Write): RunProjectChecks or scoped lint/type after file changes.',
    'Goal Stop gate: Mission/Ultrawork hard-blocks done without WorkGraph evidence.',
    'Plain /goal: soft advisory on UpdateGoal(complete) when no evidence gate ran.',
    'W6 soft sensor: recent test/command failures append a non-blocking done warning.',
  ];
}

/** Redaction posture — agent-core SSOT; always active when wired. */
export function securitySecretRedactionLines(): readonly string[] {
  return [
    redactSecretsStatusLine(),
    `· ${REDTEAM_SOFT_SUITE_TIP}`,
    'Sensitive paths blocked from Read/Write/Edit (.env, SSH, cloud creds, kubeconfig).',
    'Bash hard-blocks cat/source/base64 of secrets — no force escape.',
    'Glob/Grep/RepoQuery filter .env even when includeIgnored is true.',
    'Tool/log diagnostics pass through redactSecretsInText before transcript render.',
    'Never commit API keys — env vars or Settings → Accounts.',
    'Search/index skips credential stores by default.',
  ];
}

export function securityNavigationLines(): readonly string[] {
  return [
    'Settings → Permission — manual / auto / yolo approval matrix',
    'Settings → Never-Halt — OAuth refresh, breaker, permission queue',
    'Settings → MCP — install, toggle, reload servers + tool allowlists',
    'Settings → Network / Proxy — HTTPS_PROXY egress posture',
    'Settings → Telemetry — on/off posture, local-only tips',
    '/bench — redaction gate evidence',
  ];
}

export function buildSecuritySettingsLines(input: SecurityGlanceInput): readonly string[] {
  return [
    '── Security glance (§9.2) ───────────────────',
    'Read-only inventory — no toggles here; use linked settings below.',
    '',
    '── Permission mode ─────────────────────────',
    formatPermissionModeLine(
      input.permissionMode,
      input.permissionFromSession,
      input.permissionInterventions,
    ),
    '',
    '── Path sandbox ────────────────────────────',
    ...formatWorkspaceSandboxLines(input.workDir, input.additionalDirs, input.sandboxProfile),
    '',
    '── Network egress ──────────────────────────',
    ...formatNetworkEgressLines(input.network),
    '',
    '── Secrets & redaction ─────────────────────',
    ...securitySecretRedactionLines(),
    '',
    '── Verification sensors ────────────────────',
    ...securitySensorLines(),
    '',
    '── MCP tool allowlist ──────────────────────',
    ...formatMcpAllowlistLines(input.mcpLive, input.mcpConfig),
    '',
    '── Related settings ────────────────────────',
    ...securityNavigationLines(),
  ];
}
