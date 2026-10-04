/**
 * Security settings glance — inventory + path-sandbox copy for SSOT §9.2.
 * Lexical Bash path guards or native Bash execution confinement; not a whole-host sandbox.
 */

import type { PermissionMode } from '@superliora/sdk';
import {
  redactSecretsStatusLine,
} from '@superliora/sdk';

import type { NetworkGlanceInput } from '../network/network-glance';

export type SecuritySandboxProfile = 'off' | 'workspace' | 'read-only';
export type SecuritySandboxEnforcement = 'lexical' | 'process';



export interface SecurityGlanceInput {
  readonly permissionMode: PermissionMode;
  readonly permissionFromSession?: PermissionMode | undefined;
  readonly sandboxProfile?: SecuritySandboxProfile | undefined;
  readonly sandboxEnforcement?: SecuritySandboxEnforcement | undefined;
  readonly processSandboxWarning?: string | undefined;
  readonly workDir: string;
  readonly additionalDirs: readonly string[];
  readonly network?: NetworkGlanceInput | undefined;
}

const SANDBOX_PROFILE_TIPS: Readonly<Record<SecuritySandboxProfile, string>> = {
  workspace:
    'Lexical Bash path tokens outside workspace roots (+ /add-dir) are denied; this is not execution isolation.',
  'read-only': 'Lexical Bash write checks apply; read paths follow workspace root rules (not OS isolation).',
  off: 'Default — absolute paths outside roots are allowed (sensitive paths still blocked).',
};

const SANDBOX_ENFORCEMENT_TIPS: Readonly<Record<SecuritySandboxEnforcement, string>> = {
  lexical: 'Bash path tokens only (default).',
  process:
    'Native Bash execution requires Docker; unavailable isolation blocks execution. No host fallback.',
};

/**
 * Honest path-sandbox tip — Settings → Security picker + status panel.
 * Lexical Bash token guard; not OS isolation.
 */
export const SECURITY_SANDBOX_TIP =
  'Lexical path sandbox (not OS isolation): off | workspace | read-only. workspace checks Bash path tokens against roots; read-only applies write checks; off allows absolute outside paths. Process enforcement confines native Bash execution only: Docker required, no host fallback. The host application, plugins, and raw Kaos remain trusted; this is not a whole-filesystem or all-tool sandbox. Settings → Security · --sandbox · --sandbox-enforcement · /add-dir for extra roots.';

/** Compact secrets/redaction tip — agent-core SSOT. */
export const SECURITY_REDACTION_TIP =
  `${redactSecretsStatusLine()} · Never commit keys — use env vars or Settings → Accounts.`;


/** One-line OS-isolation disclaimer for picker footer / glance. */
export const SECURITY_NOT_OS_SANDBOX =
  'Not an OS sandbox in lexical mode — Bash path-token checks only. Process mode confines native Bash execution only. Host application, plugins, and raw Kaos remain trusted; other tools and host network egress are outside this boundary.';

export function formatPermissionModeLine(
  mode: PermissionMode,
  sessionMode?: PermissionMode | undefined,
): string {
  const lines: string[] = [];
  if (sessionMode !== undefined && sessionMode !== mode) {
    lines.push(`Current: ${mode} (TUI) · session reports ${sessionMode}`);
  } else if (sessionMode !== undefined) {
    lines.push(`Current: ${mode} · live session confirms · /permission to change`);
  } else {
    lines.push(`Current: ${mode} · footer badge · /permission to change`);
  }


  return lines.join('\n');
}

export function formatSandboxProfileLine(profile: SecuritySandboxProfile | undefined): string {
  if (profile === undefined) {
    return 'Sandbox profile: off (default when unset — opt in via Settings → Security)';
  }
  return `Sandbox profile: ${profile} — ${SANDBOX_PROFILE_TIPS[profile]}`;
}

export function formatSandboxEnforcementLine(
  enforcement: SecuritySandboxEnforcement | undefined,
  warning?: string | undefined,
): string {
  const mode = enforcement ?? 'lexical';
  const line = `Sandbox enforcement: ${mode} — ${SANDBOX_ENFORCEMENT_TIPS[mode]}`;
  if (warning !== undefined && warning.length > 0) {
    return `${line}\n${warning}`;
  }
  return line;
}

export function formatWorkspaceSandboxLines(
  workDir: string,
  additionalDirs: readonly string[],
  sandboxProfile?: SecuritySandboxProfile | undefined,
  sandboxEnforcement?: SecuritySandboxEnforcement | undefined,
  processSandboxWarning?: string | undefined,
): readonly string[] {
  const lines = [`Workspace root: ${workDir}`];
  if (additionalDirs.length > 0) {
    lines.push(`Extra roots (+${String(additionalDirs.length)}): ${additionalDirs.join(', ')}`);
  }
  lines.push(formatSandboxProfileLine(sandboxProfile));
  lines.push(formatSandboxEnforcementLine(sandboxEnforcement, processSandboxWarning));
  lines.push(SECURITY_NOT_OS_SANDBOX);
  lines.push(
    'Change: Settings → Security · config.toml sandboxProfile / sandboxEnforcement · local.toml workspace.sandbox_profile / sandbox_enforcement · --sandbox · --sandbox-enforcement · SUPERLIORA_SANDBOX · SUPERLIORA_SANDBOX_ENFORCEMENT.',
  );
  lines.push('Extra roots: /add-dir · default is off (vibe-coding friendly). --no-process-sandbox conflicts with process enforcement.');
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
    lines.push('SOCKS detected — local loopback stays direct.');
  }
  lines.push('Full env glance: Settings → Network / Proxy.');
  return lines;
}


/** Redaction posture — agent-core SSOT; always active when wired. */
export function securitySecretRedactionLines(): readonly string[] {
  return [
    redactSecretsStatusLine(),
    'Bash hard-blocks cat/source/base64 of secrets — no force escape.',
    'Tool/log diagnostics pass through redactSecretsInText before transcript render.',
    'Never commit API keys — env vars or Settings → Accounts.',
  ];
}

export function securityNavigationLines(): readonly string[] {
  return [
    'Settings → Permission — manual / auto / yolo approval matrix',
    'Settings → Network / Proxy — HTTPS_PROXY egress posture',
    'Settings → Telemetry — on/off posture, local-only tips',
  ];
}

export function buildSecuritySettingsLines(input: SecurityGlanceInput): readonly string[] {
  return [
    '── Security glance (§9.2) ───────────────────',
    'Path sandbox is configurable below; other rows are live inventory.',
    '',
    '── Permission mode ─────────────────────────',
    formatPermissionModeLine(
      input.permissionMode,
      input.permissionFromSession,
    ),
    '',
    '── Path sandbox ────────────────────────────',
    ...formatWorkspaceSandboxLines(
      input.workDir,
      input.additionalDirs,
      input.sandboxProfile,
      input.sandboxEnforcement,
      input.processSandboxWarning,
    ),
    '',
    '── Network egress ──────────────────────────',
    ...formatNetworkEgressLines(input.network),
    '',
    '── Secrets & redaction ─────────────────────',
    ...securitySecretRedactionLines(),
    '',
    '── Related settings ────────────────────────',
    ...securityNavigationLines(),
  ];
}
