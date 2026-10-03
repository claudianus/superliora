import type { Agent } from '..';
import { estimateTokens, estimateTokensForMessages, estimateTokensForTools } from '../../utils/tokens';
import type { ContextComposition, ContextCompositionSegment, ContextMessage } from './types';

export function buildContextComposition(agent: Agent, history: readonly ContextMessage[]): ContextComposition {
  const systemPromptTokens = estimateTokens(agent.config.systemPrompt);
  const meta = agent.config.systemPromptMeta;
  const systemPromptChildren: ContextCompositionSegment[] = [];
  if (meta !== undefined) {
    systemPromptChildren.push({ label: 'Base instructions', tokens: Math.max(0, systemPromptTokens - meta.agentsMdTokens - meta.cwdListingTokens - meta.additionalDirsTokens) });
    if (meta.agentsMdTokens > 0) systemPromptChildren.push({ label: 'AGENTS.md', tokens: meta.agentsMdTokens });
    if (meta.cwdListingTokens > 0) systemPromptChildren.push({ label: 'CWD listing', tokens: meta.cwdListingTokens });
    if (meta.additionalDirsTokens > 0) systemPromptChildren.push({ label: 'Additional dirs', tokens: meta.additionalDirsTokens });
  }
  const tools = agent.tools.loopTools;
  const toolTokens = estimateTokensForTools(tools);
  const toolChildren: ContextCompositionSegment[] = [];
  for (const tool of tools) {
    toolChildren.push({ label: tool.name, tokens: estimateTokens(tool.name) + estimateTokens(tool.description) + estimateTokens(JSON.stringify(tool.parameters)) });
  }
  const buckets: Record<string, number> = {};
  let conversationTokens = 0;
  for (const message of history) {
    const tokens = estimateTokensForMessages([message]);
    const label = message.role === 'assistant' ? 'Assistant'
      : message.role === 'tool' ? 'Tool results'
      : message.origin?.kind === 'compaction_summary' ? 'Compaction summary'
      : message.origin?.kind === 'shell_command' ? 'Shell commands'
      : message.origin?.kind === 'background_task' ? 'Background tasks'
      : message.origin === undefined || message.origin.kind === 'user' ? 'User prompts' : 'Other';
    buckets[label] = (buckets[label] ?? 0) + tokens;
    conversationTokens += tokens;
  }
  const conversationChildren: ContextCompositionSegment[] = [];
  for (const [label, tokens] of Object.entries(buckets)) if (tokens > 0) conversationChildren.push({ label, tokens });
  return {
    totalTokens: systemPromptTokens + toolTokens + conversationTokens,
    maxContextTokens: agent.config.modelCapabilities.max_context_tokens ?? 0,
    segments: [
      { label: 'System prompt', tokens: systemPromptTokens, children: systemPromptChildren },
      { label: 'Tool definitions', tokens: toolTokens, children: toolChildren },
      { label: 'Conversation', tokens: conversationTokens, children: conversationChildren },
    ],
  };
}
