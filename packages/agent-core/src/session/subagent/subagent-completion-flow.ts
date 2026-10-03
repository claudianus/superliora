import type { Agent } from '../../agent';
import type { PromptOrigin } from '../../agent/context';
import { readSubagentCheckpoint, buildCheckpointRecoveryReminder } from './subagent-checkpoint';
import { resolveSubagentDeadlineMs } from './subagent-errors';
import { emitSubagentStarted, observeFirstRequest } from './subagent-events';
import type { RunSubagentOptions, SubagentCompletion } from './subagent-host-types';
import { runChildTurnToCompletion } from './subagent-run-lifecycle';
import { attachToolStreamBridge, startProgressReporter } from './subagent-telemetry';
import { snapshotChildWork, collectFilesChanged, type GitWorkSnapshot } from './subagent-work-snapshot';


const SUBAGENT_PROMPT_ORIGIN: PromptOrigin = { kind: 'system_trigger', name: 'subagent' };

export function lastAssistantText(agent: Agent): string {
  for (let index = agent.context.history.length - 1; index >= 0; index -= 1) {
    const message = agent.context.history[index];
    if (message?.role !== 'assistant') continue;
    return message.content.filter((part) => part.type === 'text').map((part) => part.text).join('').trim();
  }
  return '';
}


export async function runPromptTurn(
  parent: Agent,
  childId: string,
  child: Agent,
  profileName: string,
  options: RunSubagentOptions,
): Promise<SubagentCompletion> {
  options.signal.throwIfAborted();
  emitSubagentStarted(parent, childId, options);
  const workSnapshot = await snapshotChildWork(child, options.signal);
  options.signal.throwIfAborted();
  const turnId = child.turn.prompt([{ type: 'text', text: options.prompt }], SUBAGENT_PROMPT_ORIGIN);
  if (turnId === null) throw new Error(`Agent instance "${childId}" could not start a turn`);
  observeFirstRequest(child, options);
  return waitForChildCompletion(parent, childId, child, profileName, options, workSnapshot);
}

export async function waitForChildCompletion(
  parent: Agent,
  childId: string,
  child: Agent,
  profileName: string,
  options: RunSubagentOptions,
  workSnapshot: GitWorkSnapshot,
): Promise<SubagentCompletion> {
  const deadlineMs = resolveSubagentDeadlineMs(options.timeoutMs);
  const disposeProgress = startProgressReporter(parent, child, childId, profileName, deadlineMs > 0 ? deadlineMs : undefined, options.signal);
  const disposeToolStream = attachToolStreamBridge(parent, child, childId, profileName, options);
  let completion: SubagentCompletion | undefined;
  let runError: unknown;
  let runFailed = false;
  try {
    completion = await collectChildCompletion(parent, child, childId, profileName, options, workSnapshot);
  } catch (error) {
    runError = error;
    runFailed = true;
  }
  disposeToolStream();
  try {
    await disposeProgress();
  } catch (error) {
    if (runFailed) throw new AggregateError([runError, error], 'Worker execution and progress cleanup failed.', { cause: runError });
    throw error;
  }
  if (runFailed) throw runError;
  return completion!;
}

export async function collectChildCompletion(
  _parent: Agent,
  child: Agent,
  childId: string,
  _profileName: string,
  options: RunSubagentOptions,
  workSnapshot: GitWorkSnapshot,
): Promise<SubagentCompletion> {
  await runChildTurnToCompletion(child, options.signal);
  const result = lastAssistantText(child);
  const usage = child.usage.data().total;
  const filesChanged = await collectFilesChanged(child.kaos, child.config.cwd, workSnapshot, options.signal);
  return { status: 'completed', result, usage, filesChanged, context: { agentId: childId, contextTokens: child.context.tokenCount } };
}


export function prepareResumeCheckpoint(childId: string, child: Agent): void {
  const checkpoint = readSubagentCheckpoint(childId);
  if (checkpoint === undefined) return;
  child.context.appendSystemReminder(buildCheckpointRecoveryReminder(checkpoint), { kind: 'system_trigger', name: 'subagent-checkpoint' });
}

