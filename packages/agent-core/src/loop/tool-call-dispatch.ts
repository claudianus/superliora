import { trackToolCallPattern } from './tool-call-guards';
import type {
  PreflightedToolCall,
  ToolCallDisplayFields,
  ToolCallStepContext,
} from './tool-call-types';

/**
 * Record `tool.call` in provider order. Reusing the provider/API tool-call id
 * keeps transcript linkage on one canonical identity.
 *
 * Tool activity stays on tool cards / progress surfaces. Do not inject a
 * synthetic assistant `text.delta` preamble from `execution.description`
 * ("Reading …", "Updating …") — that reads like model speech and is not.
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
