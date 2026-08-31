/**
 * Packaged-host sidecar repair for the browser-use lane.
 *
 * The installer (scripts/install/sidecars.mjs) places cloakbrowser +
 * playwright-core into `<installDir>/node_modules` next to the SEA binary, but
 * observed-upgrade paths and soft failures can leave the host without them —
 * and then every VerifySurface call dies on the external
 * `import('playwright-core')`. `browser-use install` had no repair path in
 * packaged hosts (no source packageRoot), so this mirrors the installer's
 * exact command against the documented install layout.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Sidecar pins (mirror of scripts/install/sidecars.mjs — update both together).
 */
export const SIDECAR_CLOAKBROWSER_VERSION = '0.5.5';
export const SIDECAR_PLAYWRIGHT_CORE_VERSION = '1.61.1';

export interface InstallDirResolution {
  readonly installDir: string;
  readonly nodeModulesDir: string;
}

/**
 * Documented install layout: `<root>/bin/liora.exe` + `<root>/node_modules`.
 * Falls back to node_modules beside the exe when there is no bin/ parent.
 */
export function resolveBrowserUseInstallDir(
  execPath: string = process.execPath,
): InstallDirResolution | undefined {
  const execDir = dirname(execPath);
  const parentRoot = join(execDir, '..');
  // Documented layout: <root>/bin/liora.exe + <root>/node_modules
  if (existsSync(join(parentRoot, 'bin'))) {
    return { installDir: parentRoot, nodeModulesDir: join(parentRoot, 'node_modules') };
  }
  if (existsSync(join(execDir, 'node_modules'))) {
    return { installDir: execDir, nodeModulesDir: join(execDir, 'node_modules') };
  }
  // No layout marker (dev/source runs) — default to the documented parent layout.
  return { installDir: parentRoot, nodeModulesDir: join(parentRoot, 'node_modules') };
}

export interface SidecarInstallResult {
  readonly ok: boolean;
  /** Human-readable summary for the CLI output. */
  readonly detail: string;
}

export interface SidecarInstallOptions {
  readonly execPath?: string | undefined;
  /** Test seam. */
  readonly run?: (command: string, args: readonly string[], cwd: string) => {
    readonly status: number | null;
    readonly stderr?: string | undefined;
  } | undefined;
}

/** `pnpm add --ignore-workspace cloakbrowser@X playwright-core@Y` into the install dir. */
export function installBrowserUseSidecars(
  options: SidecarInstallOptions = {},
): SidecarInstallResult {
  const resolution = resolveBrowserUseInstallDir(options.execPath);
  if (resolution === undefined) {
    return { ok: false, detail: 'browser-use sidecars: no install dir detected' };
  }
  const { installDir, nodeModulesDir } = resolution;
  try {
    mkdirSync(nodeModulesDir, { recursive: true });
  } catch {
    return { ok: false, detail: `browser-use sidecars: cannot create ${nodeModulesDir}` };
  }
  const run = options.run ?? defaultRun;
  const result = run(
    'corepack',
    [
      'pnpm',
      'add',
      '--ignore-workspace',
      `cloakbrowser@${SIDECAR_CLOAKBROWSER_VERSION}`,
      `playwright-core@${SIDECAR_PLAYWRIGHT_CORE_VERSION}`,
    ],
    installDir,
  );
  if (result === undefined || result.status !== 0) {
    const stderr = result?.stderr?.trim();
    return {
      ok: false,
      detail:
        `browser-use sidecar install failed in ${installDir}` +
        (stderr === undefined || stderr.length === 0 ? '' : `: ${stderr}`),
    };
  }
  return { ok: true, detail: `browser-use sidecars installed in ${nodeModulesDir}` };
}

function defaultRun(
  command: string,
  args: readonly string[],
  cwd: string,
): { readonly status: number | null; readonly stderr?: string | undefined } | undefined {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  if (result.error !== undefined) {
    return { status: -1, stderr: result.error.message };
  }
  return { status: result.status, stderr: result.stderr };
}
