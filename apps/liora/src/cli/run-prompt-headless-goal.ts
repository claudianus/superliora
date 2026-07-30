import type { GoalSnapshot, Session } from '@superliora/sdk';

import {
  captureUltraworkSnapshot,
  prepareUltraworkSession,
  rollbackUltraworkSession,
  type UltraworkSessionSnapshot,
} from '#/tui/commands/ultrawork-lifecycle';
import {
  formatGoalSummaryText,
  goalExitCode,
  goalSummaryJson,
  type HeadlessGoalCreate,
} from './goal-prompt';
import type { PromptOutputFormat } from './options';
import type { PromptOutput } from './run-prompt-io';
import { requireConfiguredModel } from './run-prompt-session';
import { runPromptTurn } from './run-prompt-turn';

type HeadlessUltraworkSetup = UltraworkSessionSnapshot;

export async function runHeadlessGoal(
  session: Session,
  goal: HeadlessGoalCreate,
  model: string | undefined,
  outputFormat: PromptOutputFormat,
  showThinking: boolean,
  stdout: PromptOutput,
  stderr: PromptOutput,
  recoveryPrefix?: string,
): Promise<void> {
  requireConfiguredModel(model);
  const setup = goal.ultrawork
    ? await prepareHeadlessUltrawork(session, goal.objective, {
        preservePlan: recoveryPrefix !== undefined,
      })
    : undefined;
  let goalCreated = false;
  let completedSnapshot: GoalSnapshot | null = null;
  const unsubscribeGoalEvents = session.onEvent((event) => {
    if (
      event.type === 'goal.updated' &&
      event.agentId === 'main' &&
      event.change?.kind === 'completion' &&
      event.snapshot !== null
    ) {
      completedSnapshot = event.snapshot;
    }
  });
  try {
    await session.createGoal({
      objective: goal.objective,
      replace: goal.replace,
    });
    goalCreated = true;
    const turnPrompt = mergeRecoveryPrompt(goal.prompt ?? goal.objective, recoveryPrefix);
    await runPromptTurn(session, turnPrompt, outputFormat, showThinking, stdout, stderr);
  } catch (error) {
    if (!goalCreated && setup !== undefined) {
      await rollbackUltraworkSession(session, setup);
    }
    throw error;
  } finally {
    unsubscribeGoalEvents();
    if (goalCreated || completedSnapshot !== null) {
      const snapshot = completedSnapshot ?? (await session.getGoal()).goal;
      if (outputFormat === 'stream-json') {
        stdout.write(`${JSON.stringify(goalSummaryJson(snapshot))}\n`);
      } else {
        stderr.write(`${formatGoalSummaryText(snapshot)}\n`);
      }
      // Map the terminal goal status to a distinct, non-fatal exit code. A turn
      // that threw (error / cancellation) already propagates its own exit path.
      if (snapshot !== null && snapshot.status !== 'complete') {
        process.exitCode = goalExitCode(snapshot.status);
      }
    }
  }
}

export async function maybeAutoResumeHeadlessUltrawork(
  session: Session,
  stderr: PromptOutput,
): Promise<string | undefined> {
  const result = await session.tryAutoResumeUltrawork();
  if (result === null) return undefined;
  stderr.write(
    `Ultrawork auto-resumed at stage ${result.resumed.run.stage} (run ${result.resumed.run.id}).\n`,
  );
  return result.resumed.recoveryPrompt;
}

export function mergeRecoveryPrompt(prompt: string, recoveryPrefix?: string): string {
  if (recoveryPrefix === undefined || recoveryPrefix.length === 0) return prompt;
  return `${recoveryPrefix}\n\n${prompt}`;
}

async function prepareHeadlessUltrawork(
  session: Session,
  initialContext = '',
  options: { readonly preservePlan?: boolean } = {},
): Promise<HeadlessUltraworkSetup> {
  const status = await session.getStatus();
  const setup = captureUltraworkSnapshot(
    status.planMode,
    status.swarmMode === true,
    status.premiumQualityMode === true,
  );
  // Spec/contract: headless Ultrawork defaults to Manual interview mode (no TUI chooser).
  if (status.permission !== 'manual') {
    await session.setPermission('manual');
  }
  await prepareUltraworkSession(session, setup, initialContext, options);
  return setup;
}
