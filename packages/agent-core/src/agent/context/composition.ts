import type { Agent } from '..';
import { estimateTokens, estimateTokensForMessages, estimateTokensForTools } from '../../utils/tokens';
import type { ContextComposition, ContextCompositionSegment, ContextMessage } from './types';

/** Compute a full context-window composition breakdown. */
export function buildContextComposition(
  agent: Agent,
  history: readonly ContextMessage[],
): ContextComposition {
  const systemPromptTokens = estimateTokens(agent.config.systemPrompt);
  const meta = agent.config.systemPromptMeta;
  const systemPromptChildren: ContextCompositionSegment[] = [];
  if (meta !== undefined) {
    const knownTokens =
      meta.agentsMdTokens + meta.cwdListingTokens + meta.skillsTokens + meta.additionalDirsTokens;
    const baseTokens = Math.max(0, systemPromptTokens - knownTokens);
    systemPromptChildren.push({ label: 'Base instructions', tokens: baseTokens });
    if (meta.agentsMdTokens > 0) {
      systemPromptChildren.push({ label: 'AGENTS.md', tokens: meta.agentsMdTokens });
    }
    if (meta.cwdListingTokens > 0) {
      systemPromptChildren.push({ label: 'CWD listing', tokens: meta.cwdListingTokens });
    }
    if (meta.skillsTokens > 0) {
      systemPromptChildren.push({ label: 'Skills', tokens: meta.skillsTokens });
    }
    if (meta.additionalDirsTokens > 0) {
      systemPromptChildren.push({ label: 'Additional dirs', tokens: meta.additionalDirsTokens });
    }
  }

  // Tool definitions: total + top-5 heaviest.
  const loopTools = agent.tools.loopTools;
  const toolTokens = estimateTokensForTools(loopTools);
  const perTool = loopTools
    .map((tool) => ({
      label: tool.name,
      tokens:
        estimateTokens(tool.name) +
        estimateTokens(tool.description) +
        estimateTokens(JSON.stringify(tool.parameters)),
    }))
    .toSorted((a, b) => b.tokens - a.tokens);
  const topTools = perTool.slice(0, 5);
  const toolChildren: ContextCompositionSegment[] = topTools.map((t) => ({
    label: t.label,
    tokens: t.tokens,
  }));
  if (perTool.length > 5) {
    const restTokens = perTool.slice(5).reduce((sum, t) => sum + t.tokens, 0);
    toolChildren.push({ label: `… ${String(perTool.length - 5)} more`, tokens: restTokens });
  }

  // Message history: categorize by origin kind / role.
  const buckets = new Map<string, number>();
  const bump = (key: string, tokens: number): void => {
    buckets.set(key, (buckets.get(key) ?? 0) + tokens);
  };
  for (const message of history) {
    const tokens = estimateTokensForMessages([message]);
    if (message.role === 'assistant') {
      bump('Assistant', tokens);
    } else if (message.role === 'tool') {
      bump('Tool results', tokens);
    } else {
      // role === 'user' — classify by origin
      const kind = message.origin?.kind;
      switch (kind) {
        case 'user':
          bump('User prompts', tokens);
          break;
        case 'injection':
          bump('Injections', tokens);
          break;
        case 'compaction_summary':
          bump('Compaction summary', tokens);
          break;
        case 'shell_command':
          bump('Shell commands', tokens);
          break;
        case 'skill_activation':
          bump('Skill activations', tokens);
          break;
        case 'plugin_command':
          bump('Plugin commands', tokens);
          break;
        case 'background_task':
          bump('Background tasks', tokens);
          break;
        case 'cron_job':
        case 'cron_missed':
          bump('Cron notifications', tokens);
          break;
        default:
          bump('Other', tokens);
          break;
      }
    }
  }
  const conversationChildren: ContextCompositionSegment[] = [];
  for (const [label, tokens] of buckets) {
    if (tokens > 0) conversationChildren.push({ label, tokens });
  }
  conversationChildren.sort((a, b) => b.tokens - a.tokens);
  const conversationTokens = conversationChildren.reduce((sum, c) => sum + c.tokens, 0);

  const segments: ContextCompositionSegment[] = [
    {
      label: 'System prompt',
      tokens: systemPromptTokens,
      children: systemPromptChildren.length > 0 ? systemPromptChildren : undefined,
    },
    {
      label: `Tool definitions`,
      tokens: toolTokens,
      children: toolChildren.length > 0 ? toolChildren : undefined,
    },
    {
      label: 'Conversation',
      tokens: conversationTokens,
      children: conversationChildren.length > 0 ? conversationChildren : undefined,
    },
  ];

  const maxContextTokens = agent.config.modelCapabilities.max_context_tokens ?? 0;
  return {
    totalTokens: systemPromptTokens + toolTokens + conversationTokens,
    maxContextTokens,
    segments,
  };
}
