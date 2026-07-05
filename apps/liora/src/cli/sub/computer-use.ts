import {
  CuaComputerRuntime,
  installCuaDriver,
  statusCuaDriver,
  updateCuaDriver,
  type ComputerUseRuntime,
  type SetupCommandOptions,
  type SetupCommandResult,
} from '@superliora/gui-use';
import type { Command } from 'commander';
import { t, tln } from '#/cli/i18n';

interface WritableLike {
  write(chunk: string): boolean;
}

type SetupRunner = (options?: SetupCommandOptions) => Promise<SetupCommandResult>;

export interface ComputerUseCommandDeps {
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly exit: (code: number) => never;
  readonly platform: NodeJS.Platform;
  readonly install: SetupRunner;
  readonly update: SetupRunner;
  readonly status: typeof statusCuaDriver;
  readonly createRuntime: () => ComputerUseRuntime;
}

export function registerComputerUseCommand(
  parent: Command,
  deps?: Partial<ComputerUseCommandDeps>,
): void {
  const command = parent
    .command('computer-use')
    .description(t('cli.sub.computerUse.description'));

  command
    .command('install')
    .description(t('cli.sub.computerUse.cmd.install.desc'))
    .action(async () => {
      await runComputerUseCommand(deps, 'install');
    });

  command
    .command('update')
    .description(t('cli.sub.computerUse.cmd.update.desc'))
    .action(async () => {
      await runComputerUseCommand(deps, 'update');
    });

  command
    .command('status')
    .description(t('cli.sub.computerUse.cmd.status.desc'))
    .action(async () => {
      await runComputerUseCommand(deps, 'status');
    });

  command
    .command('doctor')
    .description(t('cli.sub.computerUse.cmd.doctor.desc'))
    .action(async () => {
      await runComputerUseCommand(deps, 'doctor');
    });

  command
    .command('permissions')
    .description(t('cli.sub.computerUse.cmd.permissions.desc'))
    .action(async () => {
      await runComputerUseCommand(deps, 'permissions');
    });
}

export async function handleComputerUseCommand(
  action: 'install' | 'update' | 'status' | 'doctor' | 'permissions',
  deps: Partial<ComputerUseCommandDeps> = {},
): Promise<number> {
  const resolved = resolveDeps(deps);
  if (action === 'permissions') {
    resolved.stdout.write(permissionGuidance(resolved.platform));
    return 0;
  }
  if (action === 'status') {
    let status = resolved.status();
    if (!status.installed) {
      const result = await resolved.install({ quiet: true });
      writeResultOutput(resolved, result);
      status = resolved.status();
      if (!status.installed && !result.ok) {
        resolved.stderr.write(tln('cli.runtime.computerUse.autoInstallFailed'));
      }
    }
    resolved.stdout.write(`${JSON.stringify(status, undefined, 2)}\n`);
    return status.installed ? 0 : 1;
  }
  if (action === 'doctor') {
    return runDoctor(resolved);
  }

  const runner = action === 'install' ? resolved.install : resolved.update;
  const result = await runner({ quiet: true });
  writeResultOutput(resolved, result);
  if (result.ok) return 0;
  resolved.stderr.write(tln('cli.runtime.computerUse.actionFailed', { action }));
  return 1;
}

async function runDoctor(deps: ComputerUseCommandDeps): Promise<number> {
  const runtime = deps.createRuntime();
  try {
    const status = await runtime.status();
    deps.stdout.write(`${JSON.stringify(status, undefined, 2)}\n`);
    return status.installed && status.ready !== false ? 0 : 1;
  } finally {
    await runtime.close().catch(() => undefined);
  }
}

async function runComputerUseCommand(
  deps: Partial<ComputerUseCommandDeps> | undefined,
  action: 'install' | 'update' | 'status' | 'doctor' | 'permissions',
): Promise<void> {
  const resolved = resolveDeps(deps);
  const code = await handleComputerUseCommand(action, resolved);
  if (code !== 0) resolved.exit(code);
}

function resolveDeps(deps: Partial<ComputerUseCommandDeps> | undefined): ComputerUseCommandDeps {
  return {
    stdout: deps?.stdout ?? process.stdout,
    stderr: deps?.stderr ?? process.stderr,
    exit: deps?.exit ?? ((code) => process.exit(code)),
    platform: deps?.platform ?? process.platform,
    install: deps?.install ?? installCuaDriver,
    update: deps?.update ?? updateCuaDriver,
    status: deps?.status ?? statusCuaDriver,
    createRuntime: deps?.createRuntime ?? (() => new CuaComputerRuntime()),
  };
}

function writeResultOutput(deps: ComputerUseCommandDeps, result: SetupCommandResult): void {
  if (result.stdout.length > 0) deps.stdout.write(result.stdout);
  if (result.stderr.length > 0) deps.stderr.write(result.stderr);
  if (result.error !== undefined) deps.stderr.write(`${result.error}\n`);
}

function permissionGuidance(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return [
      t('cli.runtime.computerUse.permissions.darwin.title'),
      t('cli.runtime.computerUse.permissions.darwin.line1'),
      t('cli.runtime.computerUse.permissions.darwin.line2'),
      t('cli.runtime.computerUse.permissions.darwin.line3'),
      '',
    ].join('\n');
  }
  if (platform === 'win32') {
    return [
      t('cli.runtime.computerUse.permissions.win32.title'),
      t('cli.runtime.computerUse.permissions.win32.line1'),
      t('cli.runtime.computerUse.permissions.win32.line2'),
      t('cli.runtime.computerUse.permissions.win32.line3'),
      '',
    ].join('\n');
  }
  return [
    t('cli.runtime.computerUse.permissions.linux.title'),
    t('cli.runtime.computerUse.permissions.linux.line1'),
    t('cli.runtime.computerUse.permissions.linux.line2'),
    t('cli.runtime.computerUse.permissions.linux.line3'),
    '',
  ].join('\n');
}
