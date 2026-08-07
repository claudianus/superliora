import type { PromptSubmission } from '@superliora/protocol';

import type { AgentStatePatch } from './prompt';

/**
 * `true` iff any of the runtime-control fields is defined on the patch.
 * Used to short-circuit `applyAgentState` / the prompt-body override path
 * when the caller carries nothing actionable.
 */
export function hasAnyAgentStateField(patch: AgentStatePatch): boolean {
  return (
    patch.model !== undefined ||
    patch.thinking !== undefined ||
    patch.permission_mode !== undefined ||
    patch.plan_mode !== undefined ||
    patch.goal_objective !== undefined ||
    patch.goal_control !== undefined
  );
}

/**
 * Extract the runtime-control fields from a `PromptSubmission` body into a
 * shadow-shaped patch. Returns `undefined` when the body carries none of the
 * fields — the submit path skips both shadow bootstrap and diff-dispatch in
 * that case, saving RPCs on hot content-only prompts.
 */
export function pickAgentStatePatch(body: PromptSubmission): AgentStatePatch | undefined {
  const patch: AgentStatePatch = {};
  if (body.model !== undefined) patch.model = body.model;
  if (body.thinking !== undefined) patch.thinking = body.thinking;
  if (body.permission_mode !== undefined) patch.permission_mode = body.permission_mode;
  if (body.plan_mode !== undefined) patch.plan_mode = body.plan_mode;
  if (body.goal_objective !== undefined) patch.goal_objective = body.goal_objective;
  if (body.goal_control !== undefined) patch.goal_control = body.goal_control;
  return hasAnyAgentStateField(patch) ? patch : undefined;
}
