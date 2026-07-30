import type { ContextMessage, PromptOrigin } from '@superliora/sdk';

import { currentTheme } from '../../theme';
import type { BackgroundAgentMetadata } from '../../types';
import {
  backgroundOrigin,
  collectReplayMessageContent,
  contentPartsToText,
  formatHookResultMessageForTranscript,
  pluginCommandFromOrigin,
  replayEntry,
  skillActivationFromOrigin,
  type PluginCommandProjection,
  type ReplayRenderContext,
  type SkillActivationProjection,
} from '../../utils/session/message-replay';
import { formatBackgroundAgentTranscript } from '../../utils/background/background-agent-status';
import { formatBackgroundTaskTranscript } from '../../utils/background/background-task-status';
import { formatBashOutputForDisplay } from '../../utils/shell-output';
import {
  extractBashTag,
  extractCronPrompt,
  goalOutcomeReminderFromSystemMessage,
  isGoalForkClearedSystemReminder,
  stripCronEnvelope,
} from './helpers';
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
        if (message.origin?.kind === 'hook_result') {
          this.renderHookResult(context, message);
          this.tools.renderToolCalls(context, message.toolCalls);
          return;
        }
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

  renderHookResult(context: ReplayRenderContext, message: ContextMessage): void {
    if (message.origin?.kind !== 'hook_result') return;
    this.tools.flushAssistant(context);
    this.host.appendTranscriptEntry(
      replayEntry(
        context,
        'assistant',
        formatHookResultMessageForTranscript(
          contentPartsToText(message.content),
          message.origin.event,
          message.origin.blocked === true,
        ),
        'markdown',
      ),
    );
  }

  renderCronJob(context: ReplayRenderContext, message: ContextMessage): void {
    if (message.origin?.kind !== 'cron_job') return;
    this.tools.flushAssistant(context);
    this.host.appendTranscriptEntry({
      ...replayEntry(
        context,
        'cron',
        extractCronPrompt(contentPartsToText(message.content)),
        'plain',
      ),
      cronData: {
        jobId: message.origin.jobId,
        cron: message.origin.cron,
        recurring: message.origin.recurring,
        coalescedCount: message.origin.coalescedCount,
        stale: message.origin.stale,
      },
    });
  }

  renderCronMissed(context: ReplayRenderContext, message: ContextMessage): void {
    if (message.origin?.kind !== 'cron_missed') return;
    this.tools.flushAssistant(context);
    this.host.appendTranscriptEntry({
      ...replayEntry(context, 'cron', stripCronEnvelope(contentPartsToText(message.content)), 'plain'),
      cronData: {
        missedCount: message.origin.count,
      },
    });
  }

  renderSkillActivation(
    context: ReplayRenderContext,
    skill: SkillActivationProjection,
  ): void {
    const { sessionEventHandler } = this.host;
    if (context.skillActivationIds.has(skill.activationId)) return;
    if (sessionEventHandler.renderedSkillActivationIds.has(skill.activationId)) return;
    context.skillActivationIds.add(skill.activationId);
    sessionEventHandler.renderedSkillActivationIds.add(skill.activationId);
    this.host.appendTranscriptEntry({
      ...replayEntry(context, 'skill_activation', `Activated skill: ${skill.skillName}`, 'plain'),
      skillActivationId: skill.activationId,
      skillName: skill.skillName,
      skillArgs: skill.skillArgs,
      skillTrigger: skill.trigger,
    });
  }

  renderPluginCommand(
    context: ReplayRenderContext,
    command: PluginCommandProjection,
  ): void {
    const { sessionEventHandler } = this.host;
    if (context.pluginCommandActivationIds.has(command.activationId)) return;
    if (sessionEventHandler.renderedPluginCommandActivationIds.has(command.activationId)) return;
    context.pluginCommandActivationIds.add(command.activationId);
    sessionEventHandler.renderedPluginCommandActivationIds.add(command.activationId);
    this.host.appendTranscriptEntry({
      ...replayEntry(
        context,
        'plugin_command',
        `Ran command: ${command.pluginId}:${command.commandName}`,
        'plain',
      ),
      pluginCommandActivationId: command.activationId,
      pluginId: command.pluginId,
      pluginCommandName: command.commandName,
      pluginCommandArgs: command.commandArgs,
      pluginCommandTrigger: command.trigger,
    });
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
    if (message.origin?.kind === 'hook_result') {
      this.renderHookResult(context, message);
      return;
    }
    if (message.origin?.kind === 'injection') {
      return;
    }
    if (message.origin?.kind === 'shell_command') {
      // A `!` command, replayed from records. Unwrap the XML tags back into the
      // same `$ cmd` + output view the live editor produced. (Must NOT fall into
      // the `injection` branch above — that returns without rendering.)
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
    if (message.origin?.kind === 'cron_job') {
      this.renderCronJob(context, message);
      return;
    }
    if (message.origin?.kind === 'cron_missed') {
      this.renderCronMissed(context, message);
      return;
    }
    if (isGoalForkClearedSystemReminder(message)) {
      return;
    }
    const goalReminder = goalOutcomeReminderFromSystemMessage(message);
    if (goalReminder !== null) {
      if (goalReminder !== undefined) {
        this.tools.flushAssistant(context);
        this.host.appendTranscriptEntry(
          replayEntry(context, 'assistant', goalReminder, 'markdown'),
        );
      }
      return;
    }

    this.tools.flushAssistant(context);
    const skill = skillActivationFromOrigin(message.origin);
    if (skill !== undefined) {
      this.renderSkillActivation(context, skill);
      if (message.origin?.kind === 'skill_activation' && message.origin.trigger === 'user-slash') {
        this.tools.advanceTurn(context);
      }
      return;
    }

    const pluginCommand = pluginCommandFromOrigin(message.origin);
    if (pluginCommand !== undefined) {
      this.renderPluginCommand(context, pluginCommand);
      if (message.origin?.kind === 'plugin_command' && message.origin.trigger === 'user-slash') {
        this.tools.advanceTurn(context);
      }
      return;
    }

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
