import { randomUUID } from 'node:crypto';

import { trackToolCallPattern } from './tool-call-guards';
import type {
  PreflightedToolCall,
  ToolCallDisplayFields,
  ToolCallStepContext,
} from './tool-call-types';

const MAX_SYNTHETIC_TOOL_PREAMBLE_LENGTH = 180;

/**
 * Record `tool.call` in provider order. Reusing the provider/API tool-call id
 * keeps transcript linkage on one canonical identity.
 */
export async function dispatchToolCall(
  step: ToolCallStepContext,
  call: PreflightedToolCall,
  args: unknown,
  displayFields?: ToolCallDisplayFields | undefined,
): Promise<void> {
  const { toolCall, toolName } = call;
  // Track call patterns for loop stagnation detection.
  trackToolCallPattern(toolName, args, step.log);
  await dispatchSyntheticToolPreamble(step, call, displayFields);
  await step.dispatchEvent({
    type: 'tool.call',
    uuid: toolCall.id,
    turnId: step.turnId,
    step: step.currentStep,
    stepUuid: step.stepUuid,
    toolCallId: toolCall.id,
    name: toolName,
    args,
    description: displayFields?.description,
    display: displayFields?.display,
    extras: toolCall.extras,
  });
}

async function dispatchSyntheticToolPreamble(
  step: ToolCallStepContext,
  call: PreflightedToolCall,
  displayFields: ToolCallDisplayFields | undefined,
): Promise<void> {
  if (step.toolPreamble.hasAssistantText || step.toolPreamble.emittedSyntheticPreamble) return;

  const text = syntheticToolPreambleText(call.toolName, displayFields);
  step.toolPreamble.hasAssistantText = true;
  step.toolPreamble.emittedSyntheticPreamble = true;

  step.dispatchEvent({ type: 'text.delta', delta: text });
  await step.dispatchEvent({
    type: 'content.part',
    uuid: randomUUID(),
    turnId: step.turnId,
    step: step.currentStep,
    stepUuid: step.stepUuid,
    part: { type: 'text', text },
  });
}

function syntheticToolPreambleText(
  toolName: string,
  displayFields: ToolCallDisplayFields | undefined,
): string {
  const description = displayFields?.description?.trim().replaceAll(/\s+/g, ' ');
  const raw =
    description !== undefined && description.length > 0 ? description : `I will use ${toolName}`;
  const truncated = truncateSyntheticToolPreamble(raw);
  return sentence(truncated);
}

function truncateSyntheticToolPreamble(text: string): string {
  if (text.length <= MAX_SYNTHETIC_TOOL_PREAMBLE_LENGTH) return text;
  return `${text.slice(0, MAX_SYNTHETIC_TOOL_PREAMBLE_LENGTH - 3).trimEnd()}...`;
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
