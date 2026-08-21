/**
 * Merge adjacent plain queued prompts into one dispatched turn.
 */

import type { PromptState } from './promptState';

export const COMBINED_PROMPT_SEPARATOR = '\n\n';

interface CombinePromptGate {
  readonly isPlainPrompt: boolean;
  readonly isBash: boolean;
  readonly hasImages: boolean;
  readonly isExpandedSkill: boolean;
  readonly isSynthetic: boolean;
  readonly text: string;
}

function metadataFlag(state: PromptState, key: string): boolean {
  const value = state.body.metadata?.[key];
  return value === true || value === 'true';
}

export function promptStateToCombineGate(state: PromptState): CombinePromptGate {
  let hasImages = false;
  let isBash = false;
  const texts: string[] = [];
  for (const part of state.body.content) {
    if (part.type === 'image' || part.type === 'video') hasImages = true;
    if (part.type === 'text') texts.push(part.text);
  }
  const text = texts.join('\n').trim();
  if (text.startsWith('!')) isBash = true;
  const agentId = state.body.agent_id ?? state.agentId;
  const isExpandedSkill = metadataFlag(state, 'expanded_skill');
  const isSynthetic = metadataFlag(state, 'synthetic');
  return {
    isPlainPrompt:
      text.length > 0 &&
      (agentId === undefined || agentId === 'main') &&
      !isExpandedSkill &&
      !isSynthetic,
    isBash,
    hasImages,
    isExpandedSkill,
    isSynthetic,
    text,
  };
}

function canMergePromptFront(gate: CombinePromptGate): boolean {
  return (
    gate.isPlainPrompt &&
    !gate.isBash &&
    !gate.isExpandedSkill &&
    !gate.isSynthetic &&
    gate.text.length > 0
  );
}

function canMergePromptFollower(gate: CombinePromptGate): boolean {
  return canMergePromptFront(gate) && !gate.hasImages;
}

export function combinePromptPrefixLen(states: readonly PromptState[]): number {
  const front = states[0];
  if (front === undefined) return 0;
  if (!canMergePromptFront(promptStateToCombineGate(front))) return 1;
  let n = 1;
  for (let i = 1; i < states.length; i++) {
    if (!canMergePromptFollower(promptStateToCombineGate(states[i]!))) break;
    n += 1;
  }
  return n;
}

export function mergePromptStates(states: readonly PromptState[]): PromptState {
  if (states.length <= 1) return states[0]!;
  const texts = states
    .map((state) => promptStateToCombineGate(state).text)
    .filter((text) => text.length > 0);
  const front = states[0]!;
  const nonText = front.body.content.filter((part) => part.type !== 'text');
  return {
    ...front,
    body: {
      ...front.body,
      content: [{ type: 'text', text: texts.join(COMBINED_PROMPT_SEPARATOR) }, ...nonText],
    },
  };
}
