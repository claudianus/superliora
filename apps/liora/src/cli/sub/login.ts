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
    .option('--add', t('cli.sub.login.option.add'))
    .option('--label <label>', t('cli.sub.login.option.label'))
    .option(
      '--oauth-key <key>',
      t('cli.sub.login.option.oauthKey'),
    )
    .option('--oauth-host <host>', t('cli.sub.login.option.oauthHost'))
    .action(
      async (options: {
        add?: boolean;
        label?: string;
        oauthKey?: string;
        oauthHost?: string;
      }) => {
        await runLoginFlow({
          ...(options.add === true ? { addAccount: true } : {}),
          ...(options.label === undefined ? {} : { label: options.label }),
          ...(options.oauthKey === undefined ? {} : { oauthKey: options.oauthKey }),
          ...(options.oauthHost === undefined ? {} : { oauthHost: options.oauthHost }),
        });
      },
    );
}
