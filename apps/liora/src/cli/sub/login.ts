/**
 * `liora login` — drive the OAuth device-code flow non-interactively.
 * The `authMethods.terminal-auth.args=['login']` (legacy `_meta` path)
 * advertised by the ACP server points clients at this entry point. The
 * first-class ACP `args=['--login']` path enters the same flow via
 * `liora acp --login`.
 */

import type { Command } from 'commander';
import { t } from '#/cli/i18n';

import { runLoginFlow } from './login-flow';

export function registerLoginCommand(parent: Command): void {
  parent
    .command('login')
    .description(t('cli.sub.login.description'))
    .option(
      '--oauth-key <key>',
      t('cli.sub.login.option.oauthKey'),
    )
    .option('--oauth-host <host>', t('cli.sub.login.option.oauthHost'))
    .action(async (options: { oauthKey?: string; oauthHost?: string }) => {
      await runLoginFlow({
        ...(options.oauthKey === undefined ? {} : { oauthKey: options.oauthKey }),
        ...(options.oauthHost === undefined ? {} : { oauthHost: options.oauthHost }),
      });
    });
}
