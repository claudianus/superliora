/**
 * Pure helpers + thin loaders for Harness "eyes" readiness
 * (browser-use / computer-use runtimes). Formatting is pure for tests;
 * loaders call @superliora/gui-use setup/status APIs.
 */

import {
  infoBrowserUseRuntimes,
  statusCuaDriver,
  type SetupCommandResult,
} from '@superliora/gui-use';

export type HarnessEyeLine = {
  readonly id: 'browser-use' | 'computer-use';
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

export async function loadHarnessEyesReadiness(options: {
  readonly packageRoot: string;
}): Promise<HarnessEyesReadinessReport> {
  const browser = await infoBrowserUseRuntimes({
    packageRoot: options.packageRoot,
    quiet: true,
  });
  const computer = statusCuaDriver();
  return {
    generatedAt: new Date().toISOString(),
    lines: [browserEyeFromSetupResult(browser), computerEyeFromCuaStatus(computer)],
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
