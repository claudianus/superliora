import { randomUUID } from 'node:crypto';

import type {
  SwarmBusChannel,
  SwarmBusMessage,
  SwarmBusMessageKind,
  TeamExpertAssignment,
} from '@superliora/protocol';
import { z } from 'zod';

import type { Agent } from '../../../agent';
import type { UltraSwarmRunContext } from '../../../agent/ultra-swarm-run';
import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import {
  listSwarmBusMessages,
  postSwarmBusMessage,
  publishSwarmArtifact,
  resolveExpertIdFromMentionToken,
} from '../state/swarm-bus';
import DESCRIPTION from './swarm-channel.md?raw';

export const SWARM_CHANNEL_TOOL_NAME = 'SwarmChannel' as const;

const SwarmChannelActionSchema = z.enum(['post', 'list', 'reply', 'artifact']);

export const SwarmChannelToolInputSchema = z
  .object({
    action: SwarmChannelActionSchema.describe('Bus operation: post, list, reply, or artifact.'),
    channel: z
      .enum(['standup', 'lane', 'direct', 'blocker', 'council'])
      .optional()
      .describe('Message channel for post/reply/list filters.'),
    kind: z
      .enum(['status', 'question', 'answer', 'artifact_ref', 'verdict', 'mention'])
      .optional()
      .describe('Message kind for post/reply.'),
    body: z.string().trim().min(1).max(500).optional().describe('Short coordination message.'),
    artifact_kind: z
      .enum(['decision', 'risk', 'patch_plan'])
      .optional()
      .describe('Typed artifact kind for artifact action.'),
    title: z.string().trim().min(1).max(120).optional().describe('Artifact title for artifact action.'),
    to_expert_id: z.string().trim().min(1).optional().describe('Target expert id for direct messages.'),
    thread_id: z.string().trim().min(1).optional().describe('Thread id for replies.'),
    since: z.string().trim().min(1).optional().describe('ISO timestamp filter for list.'),
    limit: z.number().int().min(1).max(48).optional().describe('Max messages to return from list.'),
  })
  .strict();

export type SwarmChannelToolInput = z.infer<typeof SwarmChannelToolInputSchema>;

export interface SwarmChannelRuntime {
  readonly parentAgent: Agent;
  readonly parentStore: ToolStore;
  readonly run: UltraSwarmRunContext;
  readonly expert: TeamExpertAssignment;
  readonly childAgentId: string;
  readonly onMessagePosted?: (input: {
    readonly message: SwarmBusMessage;
    readonly mentionExpertIds: readonly string[];
  }) => void;
}

export class SwarmChannelTool implements BuiltinTool<SwarmChannelToolInput> {
  readonly name = SWARM_CHANNEL_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SwarmChannelToolInputSchema);

  constructor(private readonly runtime: SwarmChannelRuntime) {}

  resolveExecution(args: SwarmChannelToolInput): ToolExecution {
    return {
      description: swarmChannelDescription(args),
      approvalRule: this.name,
      execute: async () => this.execution(args),
    };
  }

  private execution(args: SwarmChannelToolInput): ExecutableToolResult {
    switch (args.action) {
      case 'post':
        return this.post(args);
      case 'list':
        return this.list(args);
      case 'reply':
        return this.reply(args);
      case 'artifact':
        return this.artifact(args);
    }
  }

  private artifact(args: SwarmChannelToolInput): ExecutableToolResult {
    const kind = args.artifact_kind;
    const title = args.title;
    const summary = args.body;
    if (kind === undefined || title === undefined || summary === undefined || summary.length === 0) {
      return {
        output: 'SwarmChannel artifact requires artifact_kind, title, and body summary.',
        isError: true,
      };
    }
    try {
      const { artifact, message } = publishSwarmArtifact(this.runtime.parentStore, {
        runId: this.runtime.run.runId,
        parentToolCallId: this.runtime.run.parentToolCallId,
        from: {
          expertId: this.runtime.expert.id,
          agentId: this.runtime.childAgentId,
          name: this.runtime.expert.name,
          emoji: this.runtime.expert.emoji,
        },
        kind,
        title,
        summary,
      });
      this.runtime.onMessagePosted?.({ message, mentionExpertIds: [] });
      return {
        output: [
          'Published Swarm artifact.',
          `artifact_id=${artifact.id}`,
          `kind=${artifact.kind}`,
          `message_id=${message.id}`,
        ].join('\n'),
      };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  private post(args: SwarmChannelToolInput): ExecutableToolResult {
    const channel = args.channel ?? inferChannel(args);
    const kind = args.kind ?? inferKind(channel, args.body ?? '');
    const body = args.body;
    if (body === undefined || body.length === 0) {
      return { output: 'SwarmChannel post requires body.', isError: true };
    }
    const toExpertId = resolveDirectTarget(args, this.runtime);
    try {
      const { message, mentionExpertIds } = postSwarmBusMessage(this.runtime.parentStore, {
        runId: this.runtime.run.runId,
        parentToolCallId: this.runtime.run.parentToolCallId,
        from: {
          expertId: this.runtime.expert.id,
          agentId: this.runtime.childAgentId,
          name: this.runtime.expert.name,
          emoji: this.runtime.expert.emoji,
        },
        toExpertId,
        channel,
        kind,
        body,
        threadId: args.thread_id ?? (kind === 'question' ? `thread-${randomUUID()}` : undefined),
      });
      this.runtime.onMessagePosted?.({ message, mentionExpertIds });
      return {
        output: [
          'Posted to Swarm bus.',
          `id=${message.id}`,
          `channel=${message.channel}`,
          `kind=${message.kind}`,
          mentionExpertIds.length > 0 ? `mentions=${mentionExpertIds.join(',')}` : undefined,
        ].filter((line): line is string => line !== undefined).join('\n'),
      };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  private list(args: SwarmChannelToolInput): ExecutableToolResult {
    const messages = listSwarmBusMessages(this.runtime.parentStore, {
      since: args.since,
      channel: args.channel,
      threadId: args.thread_id,
      limit: args.limit,
    });
    if (messages.length === 0) {
      return { output: 'No Swarm bus messages matched the filter.' };
    }
    return {
      output: messages
        .map((message) => {
          const target = message.to === undefined ? 'team' : message.to.expertId;
          return `[${message.at}] ${message.from.name} → ${target} (${message.channel}/${message.kind}): ${message.body}`;
        })
        .join('\n'),
    };
  }

  private reply(args: SwarmChannelToolInput): ExecutableToolResult {
    if (args.thread_id === undefined || args.thread_id.length === 0) {
      return { output: 'SwarmChannel reply requires thread_id.', isError: true };
    }
    return this.post({
      ...args,
      action: 'post',
      kind: 'answer',
      channel: args.channel ?? 'direct',
    });
  }
}

function swarmChannelDescription(args: SwarmChannelToolInput): string {
  if (args.action === 'list') return 'Reading Swarm bus';
  if (args.action === 'reply') return 'Replying on Swarm bus';
  if (args.action === 'artifact') return 'Publishing Swarm artifact';
  return 'Posting to Swarm bus';
}

function inferChannel(args: SwarmChannelToolInput): SwarmBusChannel {
  if (args.to_expert_id !== undefined) return 'direct';
  if (args.channel !== undefined) return args.channel;
  return 'lane';
}

function inferKind(channel: SwarmBusChannel, body: string): SwarmBusMessageKind {
  if (channel === 'blocker') return 'mention';
  if (body.includes('?')) return 'question';
  if (channel === 'council') return 'verdict';
  if (channel === 'standup') return 'status';
  return 'status';
}

function resolveDirectTarget(
  args: SwarmChannelToolInput,
  runtime: SwarmChannelRuntime,
): string | undefined {
  if (args.to_expert_id !== undefined) return args.to_expert_id;
  if (args.channel !== 'direct') return undefined;
  const body = args.body ?? '';
  const match = /@([A-Za-z0-9._ -]+)/.exec(body);
  if (match === null) return undefined;
  const token = match[1];
  if (token === undefined) return undefined;
  const names = new Map(
    runtime.run.team.experts.map((expert) => [expert.id, expert.name] as const),
  );
  return resolveExpertIdFromMentionToken(token, runtime.run.team.experts.map((e) => e.id), names);
}
