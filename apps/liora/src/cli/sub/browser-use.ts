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
import {
  AsideCliMissingError,
  disableAsideSidecar,
  enableAsideSidecar,
  formatAsideSidecarStatus,
  loadAsideSidecarStatus,
  type AsideSidecarContext,
} from '#/utils/aside/aside-sidecar';

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
  readonly cwd?: () => string;
  /** Test seam for Aside CLI/mcp.json resolution. */
  readonly asideContext?: () => AsideSidecarContext;
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

  const aside = command
    .command('aside')
    .description(t('cli.sub.browserUse.cmd.aside.desc'));

  aside
    .command('status')
    .description(t('cli.sub.browserUse.cmd.aside.status.desc'))
    .action(async () => {
      const resolved = resolveDeps(deps);
      const code = await handleAsideCommand('status', resolved);
      if (code !== 0) resolved.exit(code);
    });

  aside
    .command('enable')
    .description(t('cli.sub.browserUse.cmd.aside.enable.desc'))
    .action(async () => {
      const resolved = resolveDeps(deps);
      const code = await handleAsideCommand('enable', resolved);
      if (code !== 0) resolved.exit(code);
    });

  aside
    .command('disable')
    .description(t('cli.sub.browserUse.cmd.aside.disable.desc'))
    .action(async () => {
      const resolved = resolveDeps(deps);
      const code = await handleAsideCommand('disable', resolved);
      if (code !== 0) resolved.exit(code);
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
  // short-circuit left VerifySurface dead with no repair path).
  if ((action === 'install' || action === 'update') && packageRoot === undefined) {
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

  if (action === 'status' || action === 'doctor') {
    await writeAsideSidecarBlock(resolved);
  }

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

export async function handleAsideCommand(
  action: 'status' | 'enable' | 'disable',
  deps: Partial<BrowserUseCommandDeps> = {},
): Promise<number> {
  const resolved = resolveDeps(deps);
  const ctx = resolveAsideContext(resolved);

  if (action === 'status') {
    const status = await loadAsideSidecarStatus(ctx);
    resolved.stdout.write(formatAsideSidecarStatus(status));
    return 0;
  }

  if (action === 'enable') {
    try {
      const { path, command } = await enableAsideSidecar(ctx);
      resolved.stdout.write(
        tln('cli.runtime.browserUse.aside.enabled', { command, path }),
      );
      return 0;
    } catch (error: unknown) {
      if (error instanceof AsideCliMissingError) {
        resolved.stderr.write(`${error.message}\n`);
        return 1;
      }
      throw error;
    }
  }

  const { path, found } = await disableAsideSidecar(ctx);
  if (!found) {
    resolved.stdout.write(tln('cli.runtime.browserUse.aside.notRegistered', { path }));
    return 0;
  }
  resolved.stdout.write(tln('cli.runtime.browserUse.aside.disabled', { path }));
  return 0;
}

async function writeAsideSidecarBlock(deps: BrowserUseCommandDeps): Promise<void> {
  const status = await loadAsideSidecarStatus(resolveAsideContext(deps));
  deps.stdout.write(`\n${formatAsideSidecarStatus(status)}`);
}

function resolveAsideContext(deps: BrowserUseCommandDeps): AsideSidecarContext {
  if (deps.asideContext) return deps.asideContext();
  return { cwd: deps.cwd?.() ?? process.cwd() };
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
    cwd: deps?.cwd ?? (() => process.cwd()),
    asideContext: deps?.asideContext,
  };
}

function writeResultOutput(deps: BrowserUseCommandDeps, result: SetupCommandResult): void {
  if (result.stdout.length > 0) deps.stdout.write(result.stdout);
  if (result.stderr.length > 0) deps.stderr.write(result.stderr);
  if (result.error !== undefined) deps.stderr.write(`${result.error}\n`);
}
