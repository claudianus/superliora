import type { AgentSideConnection, AvailableCommand, PromptResponse } from '@agentclientprotocol/sdk';
import {
  type BackgroundTaskInfo,
  type Event,
  type McpServerInfo,
  type Session,
  type SessionStatus,
  type SessionUsage,
} from '@superliora/sdk';

import { ACP_BUILTIN_SLASH_COMMANDS, type AcpBuiltinSlashCommandName } from './builtin-commands';
import { MAIN_AGENT_ID } from './session-constants';

/**
 * Built-in ACP slash-command handling extracted from `AcpSession`:
 * `/compact`, `/status`, `/usage`, `/mcp`, `/tasks`, `/help`, and the
 * unknown-command fallback, plus the local report formatters each one
 * renders. `AcpSession.prompt` intercepts these before they ever reach
 * `Session.prompt`; see its JSDoc for the full slash-interception
 * contract.
 */
export interface SessionCommandDeps {
  readonly session: Pick<
    Session,
    'getStatus' | 'getUsage' | 'listMcpServers' | 'listBackgroundTasks' | 'compact' | 'onEvent'
  >;
  readonly conn: Pick<AgentSideConnection, 'sessionUpdate'>;
  readonly sessionId: string;
  readonly availableCommands: readonly AvailableCommand[];
}

type CompactionCompletedResult = Extract<Event, { type: 'compaction.completed' }>['result'];

type CompactionOutcome =
  | { readonly kind: 'completed'; readonly result: CompactionCompletedResult }
  | { readonly kind: 'cancelled' };

/** Dispatch one ACP-owned built-in slash command and report its result locally. */
export async function runBuiltInSlashCommand(
  deps: SessionCommandDeps,
  name: AcpBuiltinSlashCommandName,
  args: string,
): Promise<PromptResponse> {
  try {
    switch (name) {
      case 'compact':
        await runCompactCommand(deps, args);
        break;
      case 'status':
        await emitLocalCommandMessage(deps, formatStatusReport(await deps.session.getStatus()));
        break;
      case 'usage':
        await emitLocalCommandMessage(
          deps,
          formatUsageReport(await deps.session.getUsage(), await deps.session.getStatus()),
        );
        break;
      case 'mcp':
        await emitLocalCommandMessage(deps, formatMcpReport(await deps.session.listMcpServers()));
        break;
      case 'tasks':
        await emitLocalCommandMessage(
          deps,
          formatTasksReport(await deps.session.listBackgroundTasks()),
        );
        break;
      case 'help':
        await emitLocalCommandMessage(deps, formatHelpReport(deps.availableCommands));
        break;
    }
  } catch (error) {
    await emitLocalCommandMessage(deps, `/${name} failed: ${errorMessage(error)}`);
  }
  return { stopReason: 'end_turn' };
}

/** Report an unrecognized slash command locally instead of forwarding it as text. */
export async function runUnknownSlashCommand(
  deps: Pick<SessionCommandDeps, 'conn' | 'sessionId'>,
  name: string,
): Promise<PromptResponse> {
  await emitLocalCommandMessage(
    deps,
    `Unknown ACP command: /${name}. Use /help to see available commands.`,
  );
  return { stopReason: 'end_turn' };
}

/** Push a local (non-model) `agent_message_chunk` to the ACP client. */
export async function emitLocalCommandMessage(
  deps: Pick<SessionCommandDeps, 'conn' | 'sessionId'>,
  text: string,
): Promise<void> {
  await deps.conn.sessionUpdate({
    sessionId: deps.sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  });
}

async function runCompactCommand(deps: SessionCommandDeps, args: string): Promise<void> {
  const instruction = args.trim() || undefined;
  let started = false;
  let settled = false;
  let unsubscribe: (() => void) | undefined;
  // The agent-core compaction worker emits events in this order on
  // failure: `compaction.cancelled` (from `markCanceled`) followed by
  // `error` (unless the failure happened while blocked-by-turn, in
  // which case `compact()` itself rejects). We resolve on whichever
  // terminal event arrives first and ignore the rest, so a follow-up
  // `error` after a cancelled never causes a double-settle.
  const completion = new Promise<CompactionOutcome>((resolve, reject) => {
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };
    unsubscribe = deps.session.onEvent((event: Event) => {
      if (event.agentId !== undefined && event.agentId !== MAIN_AGENT_ID) return;
      if (event.type === 'compaction.started') {
        started = true;
        void emitLocalCommandMessage(
          deps,
          instruction === undefined
            ? 'Compacting conversation context…'
            : `Compacting conversation context with instruction: ${instruction}`,
        );
        return;
      }
      if (event.type === 'compaction.completed') {
        settle(() => resolve({ kind: 'completed', result: event.result }));
        return;
      }
      if (event.type === 'compaction.cancelled') {
        settle(() => resolve({ kind: 'cancelled' }));
        return;
      }
      if (event.type === 'compaction.blocked') {
        void emitLocalCommandMessage(
          deps,
          'Compaction is blocked by the current turn; retry when the turn is idle.',
        );
        return;
      }
      // Surface any error event the worker emits, even if it lands
      // before `compaction.started` — that path is currently empty
      // (begin() throws synchronously and rejects compact()), but
      // dropping pre-start errors would silently hang the prompt if
      // the worker is ever restructured.
      if (event.type === 'error') {
        settle(() => reject(new Error(event.message)));
      }
    });
  });
  try {
    await deps.session.compact({ instruction });
    if (!started && !settled) {
      await emitLocalCommandMessage(deps, 'Compaction was not started.');
      return;
    }
    const outcome = await completion;
    if (outcome.kind === 'completed') {
      await emitLocalCommandMessage(deps, formatCompactionCompleted(outcome.result));
    } else {
      await emitLocalCommandMessage(deps, 'Compaction cancelled.');
    }
  } finally {
    unsubscribe?.();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatHelpReport(commands: readonly AvailableCommand[]): string {
  const visibleCommands: readonly AvailableCommand[] =
    commands.length > 0 ? commands : ACP_BUILTIN_SLASH_COMMANDS;
  return [
    'Available ACP commands:',
    ...visibleCommands.map((command) => {
      const hint = command.input?.hint ? ` ${command.input.hint}` : '';
      return `- /${command.name}${hint} — ${command.description}`;
    }),
  ].join('\n');
}

function formatStatusReport(status: SessionStatus): string {
  const maxTokens = status.maxContextTokens > 0 ? status.maxContextTokens.toLocaleString('en-US') : 'unknown';
  const usage = formatContextUsage(status.contextUsage);
  return [
    'Session status:',
    `- Model: ${status.model ?? '(not set)'}`,
    `- Thinking: ${status.thinkingLevel}`,
    `- Permission: ${status.permission}`,
    `- Plan mode: ${status.planMode ? 'on' : 'off'}`,
    `- Context: ${status.contextTokens.toLocaleString('en-US')} / ${maxTokens}${usage}`,
  ].join('\n');
}

function formatUsageReport(usage: SessionUsage, status: SessionStatus): string {
  const lines = ['Session usage:'];
  if (usage.total !== undefined) {
    lines.push(`- Total: ${formatTokenUsage(usage.total)}`);
  }
  if (usage.currentTurn !== undefined) {
    lines.push(`- Current turn: ${formatTokenUsage(usage.currentTurn)}`);
  }
  for (const [model, modelUsage] of Object.entries(usage.byModel ?? {})) {
    lines.push(`- ${model}: ${formatTokenUsage(modelUsage)}`);
  }
  lines.push(
    `- Context: ${status.contextTokens.toLocaleString('en-US')} / ${status.maxContextTokens.toLocaleString('en-US')}${formatContextUsage(status.contextUsage)}`,
  );
  return lines.join('\n');
}

function formatMcpReport(servers: readonly McpServerInfo[]): string {
  if (servers.length === 0) return 'No MCP servers are configured for this session.';
  return [
    `MCP servers (${servers.length}):`,
    ...servers.map((server) => {
      const base = `- ${server.name}: ${server.status} (${server.transport}, ${server.toolCount} tools)`;
      return server.error === undefined ? base : `${base}\n  Error: ${server.error}`;
    }),
  ].join('\n');
}

function formatTasksReport(tasks: readonly BackgroundTaskInfo[]): string {
  if (tasks.length === 0) return 'No background tasks for this session.';
  return [
    `Background tasks (${tasks.length}):`,
    ...tasks.map((task) => {
      const parts = [`- ${task.taskId}: ${task.status}`, task.description];
      if (task.kind === 'process') parts.push(`command=${task.command}`);
      if (task.kind === 'agent' && task.subagentType !== undefined) parts.push(`subagent=${task.subagentType}`);
      if (task.stopReason !== undefined) parts.push(`reason=${task.stopReason}`);
      return parts.join(' · ');
    }),
  ].join('\n');
}

function formatCompactionCompleted(result: CompactionCompletedResult): string {
  return [
    'Compaction completed.',
    `- Messages compacted: ${result.compactedCount.toLocaleString('en-US')}`,
    `- Tokens before: ${result.tokensBefore.toLocaleString('en-US')}`,
    `- Tokens after: ${result.tokensAfter.toLocaleString('en-US')}`,
  ].join('\n');
}

function formatTokenUsage(usage: NonNullable<SessionUsage['total']>): string {
  return [
    `input ${usage.inputOther.toLocaleString('en-US')}`,
    `output ${usage.output.toLocaleString('en-US')}`,
    `cache read ${usage.inputCacheRead.toLocaleString('en-US')}`,
    `cache creation ${usage.inputCacheCreation.toLocaleString('en-US')}`,
  ].join(', ');
}

// agent-core emits `contextUsage` as a 0..1 fraction (`contextTokens /
// maxContextTokens` — see agent-core/src/agent/index.ts:419-422). It can
// briefly exceed 1.0 when a turn overflows the budget; we still surface
// that as ">100%" rather than collapsing back into 0..1.
function formatContextUsage(contextUsage: number): string {
  if (!Number.isFinite(contextUsage) || contextUsage < 0) return '';
  return ` (${(contextUsage * 100).toFixed(1)}%)`;
}
