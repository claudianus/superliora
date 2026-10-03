import type { ContextMessage, PromptOrigin } from '@superliora/sdk';

import { currentTheme } from '../../theme';
import type { BackgroundAgentMetadata } from '../../types';
import {
  backgroundOrigin,
  collectReplayMessageContent,
  contentPartsToText,
  replayEntry,
  type ReplayRenderContext,
} from '../../utils/session/message-replay';
import { formatBackgroundAgentTranscript } from '../../utils/background/background-agent-status';
import { formatBackgroundTaskTranscript } from '../../utils/background/background-task-status';
import { formatBashOutputForDisplay } from '../../utils/shell-output';
import { extractBashTag } from './helpers';
import type { SessionReplayHost } from './types';
import type { SessionReplayToolContext } from './tool-context';

export class SessionReplayMessageRenderer {
  constructor(
    private readonly host: SessionReplayHost,
    private readonly tools: SessionReplayToolContext,
  ) {}

  renderMessage(context: ReplayRenderContext, message: ContextMessage): void {
    switch (message.role) {
      case 'user':
        this.renderUserMessage(context, message);
        return;
      case 'assistant':
        collectReplayMessageContent(context.assistant, message.content);
        this.tools.flushAssistant(context);
        this.tools.renderToolCalls(context, message.toolCalls);
        return;
      case 'tool':
        this.tools.flushAssistant(context);
        this.renderToolResult(context, message);
        return;
      case 'system':
        return;
      default:
        return;
    }
  }

  renderBackgroundTaskNotification(
    context: ReplayRenderContext,
    origin: Extract<PromptOrigin, { kind: 'background_task' }>,
  ): void {
    const { sessionEventHandler } = this.host;
    const task = sessionEventHandler.backgroundTasks.get(origin.taskId);
    if (task !== undefined && task.kind !== 'agent') {
      const status = formatBackgroundTaskTranscript({ ...task, status: origin.status });
      this.host.appendTranscriptEntry({
        ...replayEntry(context, 'status', status.headline, 'plain'),
        detail: status.detail,
        backgroundAgentStatus: status,
      });
      sessionEventHandler.backgroundTaskTranscriptedTerminal.add(origin.taskId);
      return;
    }

    const meta: BackgroundAgentMetadata = {
      agentId: origin.taskId,
      parentToolCallId: origin.taskId,
      description: task?.description,
    };
    let status = formatBackgroundAgentTranscript(
      origin.status === 'completed' ? 'completed' : 'failed',
      meta,
    );
    if (origin.status === 'lost') {
      status = {
        ...status,
        headline: status.headline.replace(' failed in background', ' lost in background'),
      };
    } else if (origin.status === 'killed') {
      status = {
        ...status,
        headline: status.headline.replace(' failed in background', ' stopped'),
      };
    } else if (origin.status === 'timed_out') {
      status = {
        ...status,
        headline: status.headline.replace(' failed in background', ' timed out'),
      };
    }
    this.host.appendTranscriptEntry({
      ...replayEntry(context, 'status', status.headline, 'plain'),
      detail: status.detail,
      backgroundAgentStatus: status,
    });
    sessionEventHandler.subAgentEventHandler.backgroundAgentMetadata.delete(meta.agentId);
  }

  private renderUserMessage(context: ReplayRenderContext, message: ContextMessage): void {
    const origin = backgroundOrigin(message);
    if (origin !== undefined) {
      this.tools.flushAssistant(context);
      this.renderBackgroundTaskNotification(context, origin);
      return;
    }
    if (message.origin?.kind === 'shell_command') {
      // A `!` command, replayed from records. Unwrap the XML tags back into the
      // same `$ cmd` + output view the live editor produced.
      this.tools.flushAssistant(context);
      const text = contentPartsToText(message.content);
      if (message.origin.phase === 'input') {
        const cmd = (extractBashTag(text, 'bash-input') ?? text).trim();
        this.tools.advanceTurn(context);
        this.host.appendTranscriptEntry(
          replayEntry(context, 'user', currentTheme.fg('shellMode', `$ ${cmd}`), 'plain', {
            bullet: '',
          }),
        );
      } else {
        const stdout = (extractBashTag(text, 'bash-stdout') ?? '').trim();
        const stderr = (extractBashTag(text, 'bash-stderr') ?? '').trim();
        const out = formatBashOutputForDisplay(stdout, stderr, message.origin.isError);
        this.host.appendTranscriptEntry(replayEntry(context, 'status', out, 'plain'));
      }
      return;
    }
    // Model-only/internal prompts are not user transcript turns.
    if (message.origin !== undefined && message.origin.kind !== 'user') return;

    this.tools.flushAssistant(context);

    this.tools.advanceTurn(context);
    this.host.appendTranscriptEntry(
      replayEntry(context, 'user', contentPartsToText(message.content), 'plain'),
    );
  }

  private renderToolResult(context: ReplayRenderContext, message: ContextMessage): void {
    const toolCallId = message.toolCallId;
    if (toolCallId === undefined) return;
    this.tools.renderToolResult(context, toolCallId, message.content, message.isError ?? false);
  }
}
