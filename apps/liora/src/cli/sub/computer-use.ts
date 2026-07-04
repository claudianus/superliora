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
    .description('Manage the local cua-driver computer-use runtime.');

  command
    .command('install')
    .description('Install cua-driver using the upstream installer.')
    .action(async () => {
      await runComputerUseCommand(deps, 'install');
    });

  command
    .command('update')
    .description('Update cua-driver using the upstream installer.')
    .action(async () => {
      await runComputerUseCommand(deps, 'update');
    });

  command
    .command('status')
    .description('Install cua-driver if needed, then print installation status.')
    .action(async () => {
      await runComputerUseCommand(deps, 'status');
    });

  command
    .command('doctor')
    .description('Run cua-driver MCP health diagnostics.')
    .action(async () => {
      await runComputerUseCommand(deps, 'doctor');
    });

  command
    .command('permissions')
    .description('Print host permission guidance for computer-use.')
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
        resolved.stderr.write(
          'Computer-use auto-install failed. Retry with `liora computer-use install`.\n',
        );
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
  resolved.stderr.write(`Computer-use ${action} failed. Retry with \`liora computer-use ${action}\`.\n`);
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
      'Computer-use permissions for macOS:',
      '- Grant Accessibility to the terminal or app that launches SuperLiora.',
      '- Grant Screen Recording to the same launcher, and to CuaDriver.app if macOS prompts for it.',
      '- Re-run `liora computer-use doctor` after changing permissions.',
      '',
    ].join('\n');
  }
  if (platform === 'win32') {
    return [
      'Computer-use permissions for Windows:',
      '- cua-driver can drive normal desktop apps without extra setup.',
      '- Apps running elevated may require launching SuperLiora from an elevated terminal.',
      '- Re-run `liora computer-use doctor` after changing permissions.',
      '',
    ].join('\n');
  }
  return [
    'Computer-use permissions for Linux:',
    '- Run under a graphical session with DISPLAY or the compositor support required by cua-driver.',
    '- Install the platform accessibility stack requested by `cua-driver` if doctor reports it missing.',
    '- Re-run `liora computer-use doctor` after changing permissions.',
    '',
  ].join('\n');
}
