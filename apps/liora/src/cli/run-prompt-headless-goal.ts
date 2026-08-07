import type { GoalSnapshot, Session } from '@superliora/sdk';

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

export async function runHeadlessGoal(
  session: Session,
  goal: HeadlessGoalCreate,
  model: string | undefined,
  outputFormat: PromptOutputFormat,
  showThinking: boolean,
  stdout: PromptOutput,
  stderr: PromptOutput,
): Promise<void> {
  requireConfiguredModel(model);
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
      gateCommand: goal.gateCommand,
    });
    goalCreated = true;
    await runPromptTurn(
      session,
      goal.prompt ?? goal.objective,
      outputFormat,
      showThinking,
      stdout,
      stderr,
    );
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