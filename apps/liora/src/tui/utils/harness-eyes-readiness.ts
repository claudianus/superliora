/**
 * Pure helpers + thin loaders for Harness "eyes" readiness
 * (browser-use / computer-use runtimes + optional Aside MCP sidecar).
 * Formatting is pure for tests; loaders call setup/status APIs.
 */

import {
  infoBrowserUseRuntimes,
  statusCuaDriver,
  type SetupCommandResult,
} from '@superliora/gui-use';

import {
  ASIDE_INSTALL_HINT,
  loadAsideSidecarStatus,
  type AsideSidecarStatus,
} from '#/utils/aside/aside-sidecar';

export type HarnessEyeLine = {
  readonly id: 'browser-use' | 'computer-use' | 'aside-sidecar';
  readonly ok: boolean;
  readonly title: string;
  readonly detail: string;
  readonly hint: string;
};

export type HarnessEyesReadinessReport = {
  readonly lines: readonly HarnessEyeLine[];
  readonly generatedAt: string;
};

export function formatHarnessEyesReadiness(
  report: HarnessEyesReadinessReport,
): string {
  const body = report.lines.map((line) => {
    const mark = line.ok ? 'OK' : 'MISSING';
    return [
      `${line.title}: ${mark}`,
      `  ${line.detail}`,
      `  → ${line.hint}`,
    ].join('\n');
  });
  return [
    'Harness eyes readiness',
    `Checked: ${report.generatedAt}`,
    '',
    ...body,
    '',
    'Agent tools: BrowserStatus / ComputerStatus when runtimes are wired into the session.',
    'Optional: Aside MCP for logged-in / private browser evidence (`liora browser-use aside enable`).',
    'CLI: `liora browser-use doctor` · `liora computer-use doctor`',
  ].join('\n');
}

export function browserEyeFromSetupResult(result: SetupCommandResult): HarnessEyeLine {
  const detail =
    summarizeSetupStdout(result.stdout) ||
    (result.error ??
    result.stderr.trim()) ||
    (result.ok ? 'Browser-use runtimes reported ready.' : 'Browser-use runtimes not ready.');
  return {
    id: 'browser-use',
    ok: result.ok,
    title: 'Browser-use',
    detail: truncate(detail, 200),
    hint: result.ok
      ? 'BrowserStatus / VerifySurface available when session has browser tools.'
      : 'Run `liora browser-use install` (or update), then re-check.',
  };
}

export function computerEyeFromCuaStatus(status: {
  readonly installed: boolean;
  readonly version?: string | undefined;
  readonly error?: string | undefined;
}): HarnessEyeLine {
  const detail = status.installed
    ? status.version !== undefined && status.version.length > 0
      ? `cua-driver: ${status.version}`
      : 'cua-driver installed.'
    : status.error ?? 'cua-driver not found on PATH.';
  return {
    id: 'computer-use',
    ok: status.installed,
    title: 'Computer-use',
    detail: truncate(detail, 200),
    hint: status.installed
      ? 'ComputerCapture / ComputerAct available when session has computer tools.'
      : 'Run `liora computer-use install` and grant OS permissions, then re-check.',
  };
}

/** Optional sidecar — MISSING does not fail harness eyes overall. */
export function asideEyeFromSidecarStatus(status: AsideSidecarStatus): HarnessEyeLine {
  if (status.ready) {
    return {
      id: 'aside-sidecar',
      ok: true,
      title: 'Aside MCP sidecar',
      detail: truncate(`CLI ${status.cliPath ?? '?'} · mcp.json enabled`, 200),
      hint: 'Use mcp__aside__* for logged-in / private page evidence when the session MCP is connected.',
    };
  }

  if (status.cliPath === undefined) {
    return {
      id: 'aside-sidecar',
      ok: false,
      title: 'Aside MCP sidecar',
      detail: 'Aside CLI not found (optional).',
      hint: `Install Aside CLI (${ASIDE_INSTALL_HINT}), then run \`liora browser-use aside enable\`.`,
    };
  }

  if (!status.mcpEnabled) {
    return {
      id: 'aside-sidecar',
      ok: false,
      title: 'Aside MCP sidecar',
      detail: truncate(`CLI found (${status.cliPath}); MCP not enabled in user mcp.json`, 200),
      hint: 'Run `liora browser-use aside enable`, then reload the session or /mcp.',
    };
  }

  return {
    id: 'aside-sidecar',
    ok: false,
    title: 'Aside MCP sidecar',
    detail: 'Aside sidecar not ready (optional).',
    hint: 'Run `liora browser-use aside enable`.',
  };
}

export async function loadHarnessEyesReadiness(options: {
  readonly packageRoot: string;
  readonly cwd?: string | undefined;
}): Promise<HarnessEyesReadinessReport> {
  const browser = await infoBrowserUseRuntimes({
    packageRoot: options.packageRoot,
    quiet: true,
  });
  const computer = statusCuaDriver();
  const aside = await loadAsideSidecarStatus({
    cwd: options.cwd ?? process.cwd(),
  });
  return {
    generatedAt: new Date().toISOString(),
    lines: [
      browserEyeFromSetupResult(browser),
      computerEyeFromCuaStatus(computer),
      asideEyeFromSidecarStatus(aside),
    ],
  };
}

function summarizeSetupStdout(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return '';
  // Prefer last non-empty lines (status summaries often end with verdict).
  return lines.slice(-3).join(' · ');
}

function truncate(text: string, max: number): string {
  const one = text.replaceAll(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, Math.max(0, max - 1))}…`;
}
