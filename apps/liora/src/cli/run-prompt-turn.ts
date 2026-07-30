import type { Event, Session } from '@superliora/sdk';

import type { PromptOutputFormat } from './options';
import type { PromptOutput } from './run-prompt-io';
import { createPromptTurnWriter } from './run-prompt-writers';

const PROMPT_MAIN_AGENT_ID = 'main';

export function runPromptTurn(
  session: Session,
  prompt: string,
  outputFormat: PromptOutputFormat,
  showThinking: boolean,
  stdout: PromptOutput,
  stderr: PromptOutput,
): Promise<void> {
  let activeTurnId: number | undefined;
  let activeAgentId: string | undefined;
  const outputWriter = createPromptTurnWriter(outputFormat, stdout, stderr, showThinking);
  let settled = false;
  let unsubscribe: (() => void) | undefined;

  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      outputWriter.finish();
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    };

    unsubscribe = session.onEvent((event) => {
      if (event.type === 'error') {
        if (event.agentId !== PROMPT_MAIN_AGENT_ID) {
          return;
        }
        finish(new Error(`${event.code}: ${event.message}`));
        return;
      }
      if (event.type === 'turn.started' && activeTurnId === undefined) {
        if (event.agentId !== PROMPT_MAIN_AGENT_ID) {
          return;
        }
        activeTurnId = event.turnId;
        activeAgentId = event.agentId;
        outputWriter.startProgress();
        return;
      }
      // Surface subagent (UltraSwarm specialist) lifecycle in headless mode.
      // Without this, a swarm run produces no specialist output in the
      // transcript — only the main-agent integration is visible.
      if (event.type === 'subagent.completed') {
        stderr.write(`[subagent ${event.subagentId}] completed: ${event.resultSummary}\n`);
        return;
      }
      if (event.type === 'subagent.failed') {
        stderr.write(`[subagent ${event.subagentId}] failed: ${event.error}\n`);
        return;
      }
      if (
        activeTurnId === undefined ||
        activeAgentId === undefined ||
        !hasTurnId(event) ||
        event.turnId !== activeTurnId ||
        event.agentId !== activeAgentId
      ) {
        return;
      }
      switch (event.type) {
        case 'turn.step.started':
        case 'turn.step.interrupted':
          outputWriter.flushAssistant();
          return;
        case 'turn.step.retrying':
          outputWriter.discardAssistant();
          return;
        case 'assistant.delta':
          outputWriter.writeAssistantDelta(event.delta);
          return;
        case 'hook.result':
          outputWriter.writeHookResult(event);
          return;
        case 'thinking.delta':
          outputWriter.writeThinkingDelta(event.delta);
          return;
        case 'tool.call.started':
          outputWriter.writeToolCall(event.toolCallId, event.name, event.args);
          return;
        case 'tool.call.delta':
          outputWriter.writeToolCallDelta(event.toolCallId, event.name, event.argumentsPart);
          return;
        case 'tool.result':
          outputWriter.writeToolResult(event.toolCallId, event.output);
          return;
        case 'tool.progress':
          if (event.update.text !== undefined && event.update.text.length > 0) {
            stderr.write(
              event.update.text.endsWith('\n') ? event.update.text : `${event.update.text}\n`,
            );
          }
          return;
        case 'turn.step.completed':
          if (event.providerRouteSelection !== undefined) {
            outputWriter.writeProviderRouteSelection(event.providerRouteSelection);
          }
          return;
        case 'turn.ended':
          if (event.reason === 'completed') {
            finish();
            return;
          }
          finish(new Error(formatTurnEndedFailure(event)));
          return;
        case 'agent.status.updated':
        case 'background.task.started':
        case 'background.task.terminated':
        case 'compaction.blocked':
        case 'compaction.cancelled':
        case 'compaction.completed':
        case 'compaction.progress':
        case 'compaction.started':
        case 'cron.fired':
        case 'goal.updated':
        case 'mcp.server.status':
        case 'session.meta.updated':
        case 'skill.activated':
        case 'tool.list.updated':
        case 'turn.started':
        case 'warning':
          return;
      }
    });

    session.prompt(prompt).catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function hasTurnId(event: Event): event is Event & { readonly turnId: number } {
  return 'turnId' in event;
}

function formatTurnEndedFailure(event: Extract<Event, { type: 'turn.ended' }>): string {
  if (event.error !== undefined) return `${event.error.code}: ${event.error.message}`;
  if (event.reason === 'filtered') {
    return 'Provider safety policy blocked the response.';
  }
  return `Prompt turn ended with reason: ${event.reason}`;
}
