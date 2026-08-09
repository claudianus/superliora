import type { SlashCommandHost } from './hub/dispatch';
import { ttui } from '../utils/tui-i18n';

export function handleCronCommand(host: SlashCommandHost, rawArgs: string): void {
  const args = rawArgs.trim();
  const tokens = args.length === 0 ? [] : args.split(/\s+/u);
  const sub = (tokens[0] ?? '').toLowerCase();

  switch (sub) {
    case '':
    case 'help':
      host.showStatus(ttui('tui.cron.usage'));
      return;
    case 'list':
    case 'ls':
      host.sendNormalUserInput(
        'List my scheduled cron jobs with the CronList tool and show a compact table: id, schedule, next run, prompt summary, and status.',
        { displayText: '/cron list' },
      );
      return;
    case 'delete':
    case 'remove': {
      const jobId = tokens.slice(1).join(' ').trim();
      if (jobId.length === 0) {
        host.showStatus(ttui('tui.cron.deleteUsage'));
        return;
      }
      host.sendNormalUserInput(
        `Delete cron job ${jobId} with the CronDelete tool. Confirm the id exists first, then report what was removed.`,
        { displayText: `/cron delete ${jobId}` },
      );
      return;
    }
    default:
      host.showStatus(ttui('tui.cron.usage'));
      return;
  }
}
