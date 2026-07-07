import type { Agent } from '../agent';
import {
  CONTINUE_GOAL_INPUT,
  detectInterruptedWorkResumeIntentWithLlm,
  hasInterruptedWorkResumeContext,
  shouldActOnResumeIntent,
  type InterruptedWorkResumeContext,
} from './resume-intent-llm';

export interface InterruptedWorkResumePromptResult {
  readonly promptText: string;
  readonly reason: string;
}

export function readInterruptedWorkResumeContext(agent: Agent): InterruptedWorkResumeContext {
  const goalSnapshot = agent.goal.getGoal().goal;
  const ultraworkRun = agent.ultrawork.getRun();
  return {
    goal: goalSnapshot,
    ultraworkRun,
    ultraworkInterruptReason: agent.ultrawork.getInterruptReason(),
  };
}

export async function maybeTransformPromptForInterruptedWorkResume(
  agent: Agent,
  userText: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<InterruptedWorkResumePromptResult | undefined> {
  const context = readInterruptedWorkResumeContext(agent);
  if (!hasInterruptedWorkResumeContext(context)) return undefined;

  const provider = agent.config.provider;
  if (provider === undefined) return undefined;

  const intent = await detectInterruptedWorkResumeIntentWithLlm(
    { generate: agent.generate, provider },
    { text: userText, context, signal: options.signal },
  );
  if (!shouldActOnResumeIntent(intent)) return undefined;

  const blockedUltrawork =
    context.ultraworkRun !== null && context.ultraworkRun.status === 'blocked';
  if (blockedUltrawork) {
    const resumed = await agent.ultrawork.resume();
    if (resumed === null) return undefined;
    return { promptText: resumed.recoveryPrompt, reason: intent.reason };
  }

  const pausedGoal =
    context.goal?.status === 'paused' || context.goal?.status === 'blocked';
  if (pausedGoal) {
    await agent.goal.resumeGoal();
    return { promptText: CONTINUE_GOAL_INPUT, reason: intent.reason };
  }

  return undefined;
}
