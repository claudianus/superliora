/**
 * `/github-connect` — show GitHub deployment-lane login readiness.
 *
 * The push lane (git push, gh repo create, GitHub Pages enable) authenticates
 * through the GitHub CLI, not the provider OAuth used for chat. This command
 * probes that lane (`gh auth status`, never reading hosts.yml directly) and
 * tells the operator exactly what to do when a push is blocked on it.
 */

import { probeGhCliLogin, type GhCliLoginStatus } from '@superliora/oauth';

import type { ColorToken } from '#/tui/theme';
import { ttui } from '../../utils/tui-i18n';
import type { SlashCommandHost } from '../hub/dispatch';

function statusColor(status: GhCliLoginStatus): ColorToken {
  return status.state === 'ok' ? 'success' : 'warning';
}

function statusLines(status: GhCliLoginStatus): string[] {
  switch (status.state) {
    case 'ok':
      return [
        ttui('tui.githubConnect.ok', { account: status.account ?? 'unknown' }),
        ttui('tui.githubConnect.okHint'),
      ];
    case 'logged_out':
      return [ttui('tui.githubConnect.loggedOut'), ttui('tui.githubConnect.loginHint')];
    case 'binary_missing':
      return [ttui('tui.githubConnect.missing'), ttui('tui.githubConnect.installHint')];
    default:
      return [
        ttui('tui.githubConnect.probeFailed'),
        status.detail ?? ttui('tui.githubConnect.loginHint'),
      ];
  }
}

export async function handleGithubConnectCommand(host: SlashCommandHost): Promise<void> {
  const status = await probeGhCliLogin();
  host.track('github_connect', { state: status.state });
  const lines = statusLines(status);
  host.showNotice(ttui('tui.githubConnect.title'), lines.join('\n'));
  for (const line of lines) {
    host.showStatus(line, statusColor(status));
  }
}
