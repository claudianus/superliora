import {
  infoBrowserUseRuntimes,
  installBrowserUseRuntimes,
  updateBrowserUseRuntimes,
  type SetupCommandOptions,
  type SetupCommandResult,
} from '@superliora/gui-use';
import type { Command } from 'commander';
import { t, tln } from '#/cli/i18n';

import { tryGetHostPackageRoot } from '#/cli/version';
import {
  installBrowserUseSidecars,
  type SidecarInstallResult,
} from '#/utils/browser-use/sidecar-install';
import { probeBrowserUseSidecars } from '#/utils/browser-use/sidecar-status';

interface WritableLike {
  write(chunk: string): boolean;
}

type SetupRunner = (options?: SetupCommandOptions) => Promise<SetupCommandResult>;

export interface BrowserUseCommandDeps {
  readonly packageRoot: () => string | undefined;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly exit: (code: number) => never;
  readonly install: SetupRunner;
  readonly update: SetupRunner;
  readonly info: SetupRunner;
  /**
   * Packaged-host repair: place cloakbrowser + playwright-core into
   * `<installDir>/node_modules` when no source packageRoot exists.
   */
  readonly installSidecars?: () => SidecarInstallResult;
  /**
   * H1: readiness probe for the disk sidecars. Injectable so tests can pin
   * "sidecars missing" without depending on the machine's node_modules layout.
   */
  readonly probeSidecars?: () => { readonly ready: boolean };
}

export function registerBrowserUseCommand(
  parent: Command,
  deps?: Partial<BrowserUseCommandDeps>,
): void {
  const command = parent
    .command('browser-use')
    .description(t('cli.sub.browserUse.description'));

  command
    .command('install')
    .description(t('cli.sub.browserUse.cmd.install.desc'))
    .action(async () => {
      await runBrowserUseCommand(deps, 'install');
    });

  command
    .command('update')
    .description(t('cli.sub.browserUse.cmd.update.desc'))
    .action(async () => {
      await runBrowserUseCommand(deps, 'update');
    });

  command
    .command('status')
    .description(t('cli.sub.browserUse.cmd.status.desc'))
    .action(async () => {
      await runBrowserUseCommand(deps, 'status');
    });

  command
    .command('doctor')
    .description(t('cli.sub.browserUse.cmd.doctor.desc'))
    .action(async () => {
      await runBrowserUseCommand(deps, 'doctor');
    });

}

export async function handleBrowserUseCommand(
  action: 'install' | 'update' | 'status' | 'doctor',
  deps: Partial<BrowserUseCommandDeps> = {},
): Promise<number> {
  const resolved = resolveDeps(deps);
  const packageRoot = resolved.packageRoot();
  // Packaged hosts have no source packageRoot, but the probes fall back to
  // npx and install/update can repair the node_modules sidecars — never gate
  // the command on source-tree presence (the old "restart in source mode"
  // short-circuit left installed browser runtimes with no repair path).
  //
  // H1: the gate must not be "packageRoot is undefined". A stray package.json
  // anywhere on the walk-up path (e.g. $HOME/package.json or
  // ~/.local/package.json left by an npx/pnpm run) makes tryGetHostPackageRoot
  // return a directory that is NOT a source checkout, so `browser-use install`
  // silently skipped the sidecar repair while `doctor` (npx-based probe) still
  // reported ok — every launch then failed with "no cloakbrowser package found
  // on disk". Gate on the real precondition instead: do the sidecars resolve?
  const needsSidecarRepair = action === 'install' || action === 'update';
  const shouldRepair =
    resolved.probeSidecars === undefined
      ? shouldRepairBrowserUseSidecars()
      : !resolved.probeSidecars().ready;
  if (needsSidecarRepair && shouldRepair) {
    const repair = (resolved.installSidecars ?? installBrowserUseSidecars)();
    if (repair.ok) {
      resolved.stdout.write(`${repair.detail}\n`);
    } else {
      resolved.stderr.write(`${repair.detail}\n`);
    }
  }
  const runner = action === 'install'
    ? resolved.install
    : action === 'update'
      ? resolved.update
      : resolved.info;
  const result = await runner({
    packageRoot,
    quiet: true,
  });
  writeResultOutput(resolved, result);

  if (result.ok) {
    if (action === 'doctor') {
      resolved.stdout.write(tln('cli.runtime.browserUse.doctorPassed'));
    }
    return 0;
  }

  const command = action === 'update' ? 'liora browser-use update' : 'liora browser-use install';
  resolved.stderr.write(
    tln('cli.runtime.browserUse.actionFailed', { action, command }),
  );
  return 1;
}

async function runBrowserUseCommand(
  deps: Partial<BrowserUseCommandDeps> | undefined,
  action: 'install' | 'update' | 'status' | 'doctor',
): Promise<void> {
  const resolved = resolveDeps(deps);
  const code = await handleBrowserUseCommand(action, resolved);
  if (code !== 0) resolved.exit(code);
}

function resolveDeps(deps: Partial<BrowserUseCommandDeps> | undefined): BrowserUseCommandDeps {
  return {
    packageRoot: deps?.packageRoot ?? tryGetHostPackageRoot,
    stdout: deps?.stdout ?? process.stdout,
    stderr: deps?.stderr ?? process.stderr,
    exit: deps?.exit ?? ((code) => process.exit(code)),
    install: deps?.install ?? installBrowserUseRuntimes,
    update: deps?.update ?? updateBrowserUseRuntimes,
    info: deps?.info ?? infoBrowserUseRuntimes,
    installSidecars: deps?.installSidecars,
    ...(deps?.probeSidecars === undefined ? {} : { probeSidecars: deps.probeSidecars }),
  };
}

/**
 * H1: decide whether the toolchain sidecars actually need repairing.
 *
 * The old gate (`packageRoot === undefined`) skipped the repair whenever any
 * `package.json` was found while walking up from the binary — including a
 * stray `$HOME/package.json` or `~/.local/package.json` left by an npx/pnpm
 * run. `doctor` still passed (it probes through npx) while every launch failed
 * with "no cloakbrowser package found on disk".
 *
 * The real precondition is the one the launch path checks: do cloakbrowser and
 * playwright-core resolve to files on disk?
 */
function shouldRepairBrowserUseSidecars(): boolean {
  try {
    return !probeBrowserUseSidecars().ready;
  } catch {
    // Probe failure must repair, not silently skip (H2-adjacent: never let an
    // error path look like a pass).
    return true;
  }
}

function writeResultOutput(deps: BrowserUseCommandDeps, result: SetupCommandResult): void {
  if (result.stdout.length > 0) deps.stdout.write(result.stdout);
  if (result.stderr.length > 0) deps.stderr.write(result.stderr);
  if (result.error !== undefined) deps.stderr.write(`${result.error}\n`);
}
