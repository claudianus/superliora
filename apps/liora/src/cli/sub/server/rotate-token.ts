/**
 * `liora server rotate-token` — generate a new persistent server token.
 *
 * Rewrites `<SUPERLIORA_HOME>/server.token` (0600, atomic). The previous token
 * stops working immediately: a running server re-reads the file on its next
 * auth check, so rotation takes effect without a restart.
 */

import { getLiveLock, rotateServerToken } from '@superliora/server';
import chalk from 'chalk';
import type { Command } from 'commander';
import { t, tln } from '#/cli/i18n';

import { darkColors } from '#/tui/theme/colors';
import { getDataDir } from '#/utils/paths';

import { accessUrlLines } from './access-urls';
import { DEFAULT_SERVER_HOST } from './shared';

export function registerRotateTokenCommand(server: Command): void {
  server
    .command('rotate-token')
    .description(t('cli.sub.server.cmd.rotateToken.desc'))
    .action(async () => {
      try {
        const token = await rotateServerToken(getDataDir());
        process.stdout.write(
          tln('cli.runtime.server.rotateTokenInvalid'),
        );

        process.stdout.write(`\n  ${chalk.bold(t('cli.runtime.server.rotateTokenNew'))} ${token}\n\n`);

        // Re-print the access links with the new token so the user can
        // reconnect immediately. When a server is running its bind host/port
        // come from the lock; otherwise there is nothing to connect to yet.
        const lock = getLiveLock();
        if (lock !== undefined) {
          const host = lock.host ?? DEFAULT_SERVER_HOST;
          for (const { label, url: href } of accessUrlLines(host, lock.port)) {
            process.stdout.write(`  ${chalk.dim(label)}${chalk.hex(darkColors.accent)(href)}\n`);
          }
        }
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
    });
}
