/** Operator Job desk slash commands use Session APIs, never model tool prompts. */

import { openInbox } from '../features/control-tower/inbox-controller';
import { openLandChoicePicker } from '../features/control-tower/land-choice-controller';
import {
  hotpathJobCancel,
  hotpathJobCreate,
  hotpathJobGc,
  hotpathJobInspect,
  hotpathJobLandChoice,
  hotpathJobList,
  hotpathJobRename,
  hotpathJobResume,
  hotpathJobReviewOrVerify,
  hotpathJobPush,
} from './job-hotpath';
import { handleAgentsCommand } from './agents';
import type { SlashCommandHost } from './hub/dispatch';
import { ttui } from '../utils/tui-i18n';
import { openJobsDrawer } from './jobs-drawer';

export function handleJobsCommand(host: SlashCommandHost, rawArgs: string): void {
  if (rawArgs.trim().length === 0) {
    void hotpathJobList(host);
    return;
  }
  handleJobCommand(host, rawArgs);
}

export function handleJobCommand(host: SlashCommandHost, rawArgs: string): void {
  const tokens = rawArgs.trim().split(/\s+/u).filter(Boolean);
  const sub = (tokens[0] ?? '').toLowerCase();
  const tail = tokens.slice(1).join(' ');
  switch (sub) {
    case '':
    case 'help':
    case '?':
      host.showStatus(ttui('tui.jobs.help'));
      return;
    case 'create':
      if (tail.length === 0) host.showStatus(ttui('tui.jobs.createUsage'));
      else void hotpathJobCreate(host, tail);
      return;
    case 'review':
    case 'verify': {
      const jobId = tokens[1] ?? '';
      if (jobId.length === 0) host.showStatus(ttui('tui.jobs.reviewOrVerifyUsage', { action: sub }));
      else void hotpathJobReviewOrVerify(host, jobId, sub, tokens.slice(2).join(' '));
      return;
    }
    case 'push':
      if (tail.length === 0) host.showStatus(ttui('tui.jobs.pushUsage'));
      else void hotpathJobPush(host, tail);
      return;
    case 'dock':
    case 'workers':
    case 'band':
      void handleAgentsCommand(host, tail);
      return;
    case 'bg':
    case 'background':
    case 'tasks':
      void host.tasksBrowserController.show();
      return;
    case 'board':
    case 'view':
    case 'open':
      host.jobBoardController.openDeck();
      return;
    case 'drawer':
    case 'sessions':
    case 'shelf':
      void openJobsDrawer(host);
      return;
    case 'deck':
    case 'monitor':
    case 'watch':
      host.jobBoardController.openDeck(tail || undefined);
      return;
    case 'list':
    case 'ls':
      void hotpathJobList(host);
      return;
    case 'inbox':
      openInbox(host);
      return;
    case 'resume':
      void hotpathJobResume(host, tail.length === 0 ? {} : { jobId: tail });
      return;
    case 'answer':
    case 'reply': {
      const jobId = tokens[1] ?? '';
      const answer = tokens.slice(2).join(' ');
      if (jobId.length === 0 || answer.length === 0) {
        host.showStatus(ttui('tui.jobs.answerUsage'));
        return;
      }
      void hotpathJobResume(host, { jobId, answer });
      return;
    }
    case 'cancel':
    case 'stop':
      if (tail.length === 0) host.showStatus(ttui('tui.jobs.cancelUsage'));
      else void hotpathJobCancel(host, tail);
      return;
    case 'inspect':
    case 'show':
    case 'get':
      if (tail.length === 0) host.showStatus(ttui('tui.jobs.inspectUsage'));
      else void hotpathJobInspect(host, tail);
      return;
    case 'rename': {
      const jobId = tokens[1] ?? '';
      const name = tokens.slice(2).join(' ');
      if (jobId.length === 0 || name.length === 0) host.showStatus(ttui('tui.jobs.renameUsage'));
      else void hotpathJobRename(host, jobId, name);
      return;
    }
    case 'land':
      if (tail.length === 0) host.showStatus(ttui('tui.jobs.landUsage'));
      else void openLandChoicePicker(host, tail);
      return;
    case 'keep':
    case 'apply':
    case 'pr':
      if (tail.length === 0) host.showStatus(ttui('tui.jobs.landUsage'));
      else void hotpathJobLandChoice(host, tail, sub);
      return;
    case 'gc':
      void hotpathJobGc(host);
      return;
    default:
      if (tokens.length === 1) void hotpathJobInspect(host, tokens[0]!);
      else host.showError(ttui('tui.jobs.unknownAction', { action: sub }));
  }
}
