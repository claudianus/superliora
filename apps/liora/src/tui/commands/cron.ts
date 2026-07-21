import type { SlashCommandHost } from './dispatch';

const CRON_USAGE =
  'Usage: /cron list — show scheduled jobs (id, schedule, prompt, status); /cron delete <jobId> — remove a job. Jobs persist across sessions; the agent manages them with the Cron tools.';

export function handleCronCommand(host: SlashCommandHost, rawArgs: string): void {
  const args = rawArgs.trim();
  const tokens = args.length === 0 ? [] : args.split(/\s+/u);
  const sub = (tokens[0] ?? '').toLowerCase();

  switch (sub) {
    case '':
    case 'help':
      host.showStatus(CRON_USAGE);
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
        host.showStatus('Provide a job id: /cron delete <jobId>. Use /cron list to find ids.');
        return;
      }
      host.sendNormalUserInput(
        `Delete cron job ${jobId} with the CronDelete tool. Confirm the id exists first, then report what was removed.`,
        { displayText: `/cron delete ${jobId}` },
      );
      return;
    }
    default:
      host.showStatus(CRON_USAGE);
      return;
  }
}
