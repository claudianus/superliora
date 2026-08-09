import { CLI_COMMAND_NAME } from '#/constant/app';
import { t } from '#/cli/i18n';
import { Command, Option } from 'commander';

import type { CLIOptions } from './options';
import { registerAcpCommand } from './sub/acp';
import { registerBrowserUseCommand } from './sub/browser-use';
import { registerComputerUseCommand } from './sub/computer-use';
import { registerDoctorCommand } from './sub/doctor';
import { registerExportCommand } from './sub/export';
import { registerLoginCommand } from './sub/login';
import { registerProviderCommand } from './sub/provider';
import { registerServerCommand } from './sub/server';
import { registerVisCommand } from './sub/vis';
import { registerWorktreeCommand } from './sub/worktree';

export type MainCommandHandler = (opts: CLIOptions) => void;
export type PluginNodeRunnerHandler = (entry: string, args: readonly string[]) => void;
export interface UpgradeCommandOptions {
  readonly fromMain?: boolean;
}

export type UpgradeCommandHandler = (
  opts: UpgradeCommandOptions,
) => void | Promise<void>;

export function createProgram(
  version: string,
  onMain: MainCommandHandler,
  onPluginNodeRunner: PluginNodeRunnerHandler = () => {},
  onUpgrade: UpgradeCommandHandler = () => {},
): Command {
  const program = new Command(CLI_COMMAND_NAME)
    .description(t('cli.description'))
    .version(version, '-V, --version')
    .allowUnknownOption(false)
    .configureHelp({ helpWidth: 100 })
    .helpOption('-h, --help', t('cli.help'))
    .usage(t('cli.usage'))
    .addHelpText('after', t('cli.helpAfter'));

  program
    .addOption(
      new Option(
        '-S, --session [id]',
        t('cli.option.session'),
      ).argParser((val: string | boolean) => (val === true ? '' : (val as string))),
    )
    .addOption(
      new Option('-r, --resume [id]')
        .hideHelp()
        .argParser((val: string | boolean) => (val === true ? '' : (val as string))),
    )
    .option('-c, --continue', t('cli.option.continue'), false)
    .addOption(new Option('-C').hideHelp().default(false))
    .option('-y, --yolo', t('cli.option.yolo'), false)
    .option('--auto', t('cli.option.auto'), false)
    .addOption(
      new Option(
        '-m, --model <model>',
        t('cli.option.model'),
      ),
    )
    .addOption(
      new Option(
        '-p, --prompt <prompt>',
        t('cli.option.prompt'),
      ),
    )
    .addOption(
      new Option(
        '--output-format <format>',
        t('cli.option.outputFormat'),
      ).choices(['text', 'stream-json']),
    )
    .option('--show-thinking', t('cli.option.showThinking'), false)
    .addOption(
      new Option(
        '--skills-dir <dir>',
        t('cli.option.skillsDir'),
      )
        .argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value])
        .default([]),
    )
    .addOption(
      new Option(
        '--plugin-dir <dir>',
        t('cli.option.pluginDir'),
      )
        .argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value])
        .default([]),
    )
    .addOption(
      new Option(
        '--channels <server>',
        'Opt-in Claude channel MCP server for inbound message inject (repeatable)',
      )
        .argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value])
        .default([]),
    )
    .addOption(
      new Option(
        '--add-dir <dir>',
        t('cli.option.addDir'),
      )
        .argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value])
        .default([]),
    )
    .addOption(new Option('--yes').hideHelp().default(false))
    .addOption(new Option('--auto-approve').hideHelp().default(false))
    .option('--plan', t('cli.option.plan'), false)
    .addOption(
      new Option(
        '--profile <name>',
        'Main agent tool profile (core, agent, superliora-full; default: core)',
      ),
    )
    .option('--resume-goal', t('cli.option.resumeGoal'), false)
    .option('--autonomous-gate <command>', t('cli.option.autonomousGate'))
    .addOption(
      new Option('--worktree [name]', t('cli.option.worktree')).argParser(
        (val: string | boolean) => (val === true ? true : (val as string)),
      ),
    );

  registerExportCommand(program);
  registerProviderCommand(program);
  registerBrowserUseCommand(program);
  registerComputerUseCommand(program);
  registerAcpCommand(program);
  registerServerCommand(program);
  registerLoginCommand(program);
  registerDoctorCommand(program);
  registerVisCommand(program);
  registerWorktreeCommand(program);
  // First-class peers: `liora update` and `liora upgrade` share one handler
  // (Upgrade Studio / install theatre). Keep both names discoverable in help.
  const runUpgrade = async (opts: { main?: boolean }): Promise<void> => {
    await onUpgrade({ fromMain: opts.main === true });
  };
  program
    .command('upgrade')
    .description(t('cli.sub.upgrade.description'))
    .option('--main', t('cli.sub.upgrade.option.main'), false)
    .action(runUpgrade);
  program
    .command('update')
    .description(t('cli.sub.upgrade.description'))
    .option('--main', t('cli.sub.upgrade.option.main'), false)
    .action(runUpgrade);

  program
    .command('__plugin_run_node', { hidden: true })
    .argument('<entry>')
    .argument('[args...]')
    .allowUnknownOption(true)
    .action((entry: string, args: string[]) => {
      onPluginNodeRunner(entry, args);
    });

  program.argument('[args...]').action((args: string[]) => {
    if (args.length > 0) {
      program.error(t('cli.error.unknownCommand', { arg: args[0]!, cmd: CLI_COMMAND_NAME }));
    }

    const raw = program.opts<Record<string, unknown>>();

    const rawSession = raw['session'] ?? raw['resume'];
    const sessionValue = rawSession === true ? '' : (rawSession as string | undefined);
    const yoloValue = raw['yolo'] === true || raw['yes'] === true || raw['autoApprove'] === true;
    const autoValue = raw['auto'] === true;

    const opts: CLIOptions = {
      session: sessionValue,
      continue: raw['continue'] === true || raw['C'] === true,
      yolo: yoloValue,
      auto: autoValue,
      plan: raw['plan'] as boolean,
      model: raw['model'] as string | undefined,
      outputFormat: raw['outputFormat'] as CLIOptions['outputFormat'],
      showThinking: raw['showThinking'] as boolean,
      prompt: raw['prompt'] as string | undefined,
      skillsDirs: raw['skillsDir'] as string[],
      pluginDirs: (raw['pluginDir'] as string[] | undefined) ?? [],
      channelServers: (raw['channels'] as string[] | undefined) ?? [],
      addDirs: raw['addDir'] as string[],
      resumeGoal: raw['resumeGoal'] as boolean,
      autonomousGate: raw['autonomousGate'] as string | undefined,
      worktree: raw['worktree'] as boolean | string | undefined,
      profile: raw['profile'] as string | undefined,
    };

    onMain(opts);
  });

  return program;
}
