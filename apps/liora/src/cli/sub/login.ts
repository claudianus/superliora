/**
 * `liora login` — drive the OAuth device-code flow non-interactively.
 * The `authMethods.terminal-auth.args=['login']` (legacy `_meta` path)
 * advertised by the ACP server points clients at this entry point. The
 * first-class ACP `args=['--login']` path enters the same flow via
 * `liora acp --login`.
 */

import type { Command } from 'commander';

import { runLoginFlow } from './login-flow';

export function registerLoginCommand(parent: Command): void {
  parent
    .command('login')
    .description('Authenticate with SuperLiora CLI via the device-code flow.')
    .option(
      '--oauth-key <key>',
      'Use a distinct OAuth storage key, preserving existing accounts as fallback refs.',
    )
    .option('--oauth-host <host>', 'Override the OAuth host for this login.')
    .action(async (options: { oauthKey?: string; oauthHost?: string }) => {
      await runLoginFlow({
        ...(options.oauthKey === undefined ? {} : { oauthKey: options.oauthKey }),
        ...(options.oauthHost === undefined ? {} : { oauthHost: options.oauthHost }),
      });
    });
}
