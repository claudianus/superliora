import type { Agent } from '../agent';
import {
  CONTINUE_GOAL_INPUT,
  detectInterruptedWorkResumeIntentWithLlm,
  hasInterruptedWorkResumeContext,
  matchExplicitResumePhrase,
  shouldActOnResumeIntent,
  type InterruptedWorkResumeContext,
  type InterruptedWorkResumeIntent,
} from './resume-intent-llm';


export function buildResumeWithSteering(
  recoveryPrompt: string,
  userText: string,
): string {
  // Soft mid-run resume can yield an empty recovery prompt when the cursor
  // builder has nothing durable yet — fall back to the goal-continue scaffold
  // so steering is never the only content and the model still gets a resume brief.
  const base =
    recoveryPrompt.trim().length > 0 ? recoveryPrompt.trimEnd() : CONTINUE_GOAL_INPUT;
  const trimmed = userText.trim();
  if (trimmed.length === 0) return base;
  return [
    base,
    '',
    '## User steering for this resume',
    'The user provided additional direction while work was interrupted. Apply it on top of the recovery cursor above.',
    '',
    trimmed,
  ].join('\n');
}

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

  // Clear short resume phrases work without a provider / LLM call.
  let intent: InterruptedWorkResumeIntent | undefined = matchExplicitResumePhrase(userText);
  if (!shouldActOnResumeIntent(intent)) {
    const provider = agent.config.provider;
    if (provider === undefined) return undefined;
    intent = await detectInterruptedWorkResumeIntentWithLlm(
      { generate: agent.generate, provider },
      { text: userText, context, signal: options.signal },
    );
    if (!shouldActOnResumeIntent(intent)) return undefined;
  }
  // shouldActOnResumeIntent narrowed intent above on every exit path that continues.
  const acted = intent;

  const run = context.ultraworkRun;
  const hasPendingWork =
    run?.workGraph?.nodes.some(
      (node) => node.status !== 'done' && node.status !== 'cancelled',
    ) === true;
  const interruptedUltrawork =
    run !== null &&
    (run.status === 'blocked' ||
      (run.status === 'running' &&
        ((context.ultraworkInterruptReason?.trim().length ?? 0) > 0 || hasPendingWork)));
  if (interruptedUltrawork) {
    const resumed = await agent.ultrawork.resume();
    if (resumed === null) return undefined;
    return {
      promptText: buildResumeWithSteering(resumed.recoveryPrompt, userText),
      reason: acted.reason,
    };
  }

  const pausedGoal =
    context.goal?.status === 'paused' || context.goal?.status === 'blocked';
  if (pausedGoal) {
    await agent.goal.resumeGoal();
    return { promptText: CONTINUE_GOAL_INPUT, reason: acted.reason };
  }

  return undefined;
}
