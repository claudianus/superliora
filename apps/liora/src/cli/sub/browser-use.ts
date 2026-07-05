import {
  infoCloakBrowser,
  installCloakBrowser,
  updateCloakBrowser,
  type SetupCommandOptions,
  type SetupCommandResult,
} from '@superliora/gui-use';
import type { Command } from 'commander';
import { t, tln } from '#/cli/i18n';

import { getHostPackageRoot } from '#/cli/version';

interface WritableLike {
  write(chunk: string): boolean;
}

type SetupRunner = (options?: SetupCommandOptions) => Promise<SetupCommandResult>;

export interface BrowserUseCommandDeps {
  readonly packageRoot: () => string;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly exit: (code: number) => never;
  readonly install: SetupRunner;
  readonly update: SetupRunner;
  readonly info: SetupRunner;
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
  const runner = action === 'install'
    ? resolved.install
    : action === 'update'
      ? resolved.update
      : resolved.info;
  const result = await runner({ cwd: resolved.packageRoot(), quiet: true });
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
    packageRoot: deps?.packageRoot ?? getHostPackageRoot,
    stdout: deps?.stdout ?? process.stdout,
    stderr: deps?.stderr ?? process.stderr,
    exit: deps?.exit ?? ((code) => process.exit(code)),
    install: deps?.install ?? installCloakBrowser,
    update: deps?.update ?? updateCloakBrowser,
    info: deps?.info ?? infoCloakBrowser,
  };
}

function writeResultOutput(deps: BrowserUseCommandDeps, result: SetupCommandResult): void {
  if (result.stdout.length > 0) deps.stdout.write(result.stdout);
  if (result.stderr.length > 0) deps.stderr.write(result.stderr);
  if (result.error !== undefined) deps.stderr.write(`${result.error}\n`);
}
