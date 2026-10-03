/**
 * `liora acp` sub-command.
 *
 * Starts the Agent Client Protocol (ACP) server over stdio so that
 * ACP-compatible clients (editors, IDEs, custom front-ends) can drive
 * a kimi-code session.
 *
 * Wire-up:
 *  - A {@link LioraHarness} is constructed with the kimi-code host identity
 *    and a dedicated `uiMode: 'acp'` so downstream telemetry can
 *    distinguish ACP sessions from the TUI.
 *  - {@link runAcpServer} owns the JSON-RPC stdio bridge and redirects
 *    rogue `console.*` traffic to stderr.
 *  - `--login` pivots into the device-code login flow instead of
 *    starting the server. This is the entry point ACP clients hit
 *    via the first-class `AuthMethodTerminal` path when they re-invoke
 *    the agent binary with the advertised `args:['--login']` appended.
 *  - On stream close or unhandled error the process exits with the
 *    appropriate code.
 */

import type { Command } from 'commander';
import { t, tln } from '#/cli/i18n';

import {
  ACP_BUILTIN_SLASH_COMMANDS,
  runAcpServer,
  type AvailableCommand,
} from '@superliora/acp-adapter';
import { createLioraHarness } from '@superliora/sdk';

import { SUPERLIORA_HOME_ENV } from '#/constant/app';
import { createLioraHostIdentity, getVersion } from '#/cli/version';

import { runLoginFlow } from './login-flow';

export function registerAcpCommand(parent: Command): void {
  parent
    .command('acp')
    .description(t('cli.sub.acp.description'))
    .option(
      '--login',
      t('cli.sub.acp.option.login'),
      false,
    )
    .action(async (opts: { login?: boolean }) => {
      if (opts.login === true) {
        await runLoginFlow();
        return;
      }
      const identity = createLioraHostIdentity();
      const harness = createLioraHarness({
        identity,
        uiMode: 'acp',
      });
      // Forward `SUPERLIORA_HOME` (if set) into `authMethods[0].env` so the
      // `liora login` subprocess clients spawn for terminal-auth writes its
      // token under the same data root the ACP server reads from. Used for
      // sandboxed test setups (Zed's `agent_servers.*.env.SUPERLIORA_HOME =
      // /tmp/...`). Production runs leave the env unset and the field stays
      // empty.
      const sandboxHome = process.env[SUPERLIORA_HOME_ENV];
      const terminalAuthEnv =
        sandboxHome !== undefined && sandboxHome.length > 0
          ? { [SUPERLIORA_HOME_ENV]: sandboxHome }
          : undefined;
      // Legacy `_meta.terminal-auth` fallback for clients that don't yet
      // honor the first-class `type:'terminal'` (Zed without the
      // AcpBetaFeatureFlag, current JetBrains plugin, etc.). `command` is
      // the absolute path to this very binary (`process.argv[1]`) so the
      // client can spawn it with `args:['login']` for the top-level
      // `liora login` subcommand — matches kimi-cli `acp/server.py:77-96`.
      const legacyCommand = process.argv[1];
      const builtinCommands: AvailableCommand[] = (ACP_BUILTIN_SLASH_COMMANDS as readonly AvailableCommand[]).map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        input: cmd.input,
      }));
      try {
        await runAcpServer(harness, {
          agentInfo: { name: 'SuperLiora CLI', version: getVersion() },
          slashCommands: builtinCommands,
          ...(terminalAuthEnv ? { terminalAuthEnv } : {}),
          ...(legacyCommand !== undefined && legacyCommand.length > 0
            ? { terminalAuthLegacyCommand: legacyCommand }
            : {}),
        });
        process.exit(0);
      } catch (error) {
        process.stderr.write(tln('cli.runtime.acp.fatalError', { message: String(error) }));
        process.exit(1);
      }
    });
}
