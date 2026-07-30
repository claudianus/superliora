/**
 * Plugin session-start and init reminders — extracted from Session class.
 */

import { ErrorCodes, LioraError } from '#/errors';
import { renderPluginSessionStartReminder } from '../../agent/injection/plugin-session-start';
import type { Agent } from '../../agent';
import { DEFAULT_INIT_PROMPT, loadAgentsMd } from '../../profile';

export function initCompletionReminder(agentsMd: string): string {
  const latest =
    agentsMd.trim().length === 0
      ? 'No AGENTS.md content was found after `/init` completed.'
      : agentsMd;
  return [
    'The user ran `/init`. The codebase was analyzed and `AGENTS.md` was generated.',
    '',
    'Latest AGENTS.md file content:',
    latest,
  ].join('\n');
}

export function shouldNeutralizePluginSessionStart(mainAgent: Agent): boolean {
  return mainAgent.context.history.some((message) => {
    const kind = message.origin?.kind;
    if (kind === 'injection') {
      return message.origin?.variant === 'plugin_session_start';
    }
    // A compaction summary replaces earlier messages (including any plugin
    // session-start reminder) with a single summary that may still carry stale
    // plugin guidance, so the origin-only check above is not sufficient.
    return kind === 'compaction_summary';
  });
}

export async function appendPluginSessionStartReminder(mainAgent: Agent): Promise<void> {
  const reminder = await renderPluginSessionStartReminder({
    sessionStarts: mainAgent.pluginSessionStarts,
    registry: mainAgent.skills?.registry,
    log: mainAgent.log,
  });
  if (reminder !== undefined) {
    mainAgent.context.appendSystemReminder(
      `${reminder}\n\nThis supersedes any earlier plugin_session_start reminder in this session.`,
      { kind: 'injection', variant: 'plugin_session_start' },
    );
  } else if (shouldNeutralizePluginSessionStart(mainAgent)) {
    mainAgent.context.appendSystemReminder(
      'There are currently no active plugin session starts. This supersedes any earlier plugin_session_start reminder in this session.',
      { kind: 'injection', variant: 'plugin_session_start' },
    );
  } else {
    return;
  }
  await mainAgent.records.flush();
}

export async function runGenerateAgentsMd(
  mainAgent: Agent,
  kimiHomeDir: string | undefined,
): Promise<void> {
  try {
    const handle = await mainAgent.subagentHost!.spawn({
      profileName: 'coder',
      parentToolCallId: 'generate-agents-md',
      prompt: DEFAULT_INIT_PROMPT,
      description: 'Initialize AGENTS.md',
      runInBackground: false,
      signal: new AbortController().signal,
    });
    await handle.completion;

    const agentsMd = await loadAgentsMd(mainAgent.kaos, kimiHomeDir);
    mainAgent.context.appendSystemReminder(initCompletionReminder(agentsMd), {
      kind: 'injection',
      variant: 'init',
    });
    await mainAgent.records.flush();
  } catch (error) {
    throw new LioraError(
      ErrorCodes.SESSION_INIT_FAILED,
      error instanceof Error ? error.message : 'Init failed',
      { cause: error },
    );
  }
}
