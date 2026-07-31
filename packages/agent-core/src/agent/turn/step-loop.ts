/**
 * Turn step loop — extracted from TurnFlow.
 *
 * Runs the agent loop for a single turn: goal injection, step hooks,
 * tool dedup/budgeting, stop-hook continuation, and context-overflow recovery.
 */

import {
  APIContextOverflowError,
  grandTotal,
} from '@superliora/kosong';

import type { Agent } from '..';
import {
  ErrorCodes,
  isKimiError,
  toKimiErrorPayload,
} from '#/errors/index';
import { isMaxStepsExceededError } from '../../loop/errors';
import {
  runTurn,
  type LoopTurnStopReason,
  type RecordStepUsageInfo,
} from '../../loop/index';
import { ToolCallDeduplicator } from './tool-dedup';
import { budgetToolResultForModel } from './tool-result-budget';
import { observeVerificationToolResult } from '../../sensors/verification-sensor-ledger';
import { toolInputRecord, toolOutputText, type TurnTelemetry } from './telemetry';
import {
  hasStepBudgetRemaining,
  isGoalOutcomeReminderOrigin,
} from './goal-driver';
import type { createTurnLoopDispatch } from './loop-dispatch';

export interface StepLoopDeps {
  readonly agent: Agent;
  readonly turnTelemetry: TurnTelemetry;
  readonly flushSteerBuffer: () => boolean;
  readonly buildDispatchEvent: (turnId: number) => ReturnType<typeof createTurnLoopDispatch>;
}

export async function runTurnStepLoop(
  deps: StepLoopDeps,
  turnId: number,
  signal: AbortSignal,
): Promise<LoopTurnStopReason> {
  const { agent, turnTelemetry } = deps;
  let stopHookContinuationUsed = false;
  let goalOutcomeMessageContinuationUsed = false;
  const deduper = new ToolCallDeduplicator({ telemetry: agent.telemetry });
  await agent.mcp?.waitForInitialLoad(signal);
  // Surface the active goal at the start of the turn (append-only; no-op when
  // there is no active goal). Each goal continuation is its own turn, so this
  // re-injects the reminder once per turn rather than per step, preserving prompt caching.
  await agent.injection.injectGoal();
  while (true) {
    signal.throwIfAborted();
    const model = agent.config.model;
    let stepUsageModel = model;
    const loopControl = agent.kimiConfig?.loopControl;
    let stopForGoalBudget = false;
    try {
      const result = await runTurn({
        turnId: String(turnId),
        signal,
        llm: agent.llm,
        buildMessages: () => agent.context.messages,
        buildMessagesStrict: () => agent.context.strictMessages,
        dispatchEvent: deps.buildDispatchEvent(turnId),
        tools: agent.tools.loopTools,
        log: agent.log,
        maxSteps: loopControl?.maxStepsPerTurn,
        maxRetryAttempts: loopControl?.maxRetriesPerStep,
        toolParallelStatus: agent.toolParallelStatus,
        recordStepUsage: async (usage, info?: RecordStepUsageInfo) => {
          stepUsageModel = info?.model ?? model;
          try {
            const snapshot = await agent.goal.recordTokenUsage(grandTotal(usage));
            stopForGoalBudget = snapshot?.budget.overBudget === true;
          } catch (error) {
            agent.log.warn('goal token accounting failed', { error });
          }
        },
        hooks: {
          beforeStep: async ({ signal: stepSignal }) => {
            deps.flushSteerBuffer();
            agent.microCompaction.detect();
            await agent.fullCompaction.beforeStep(stepSignal);
            await agent.injection.inject();
            deduper.beginStep();
            return;
          },
          afterStep: async ({ usage }) => {
            agent.usage.record(stepUsageModel, usage, 'turn');
            agent.usage.recordCacheDiagnostics(
              agent.tools.loopTools,
              0, // injection count tracked by batch injector
              agent.context.history.length,
              usage,
              stepUsageModel,
            );
            await agent.fullCompaction.afterStep();
            deduper.endStep();
            return stopForGoalBudget ? { stopTurn: true } : undefined;
          },
          // oxlint-disable-next-line no-loop-func -- stop hook continuation state is scoped to this turn.
          shouldContinueAfterStop: async (ctx) => {
            const { signal: stopSignal } = ctx;
            // 1. Flush any steered user messages.
            if (deps.flushSteerBuffer()) return { continue: true };
            stopSignal.throwIfAborted();

            if (agent.printDrainAgentTasksOnStop) {
              const remaining = agent.printDrainDeadlineMs - Date.now();
              const hasActiveAgentTask = agent.background
                .list(true)
                .some((task) => task.kind === 'agent');
              if (hasActiveAgentTask && remaining > 0) {
                await agent.background.waitForActiveTasks(
                  (task) => task.kind === 'agent',
                  { timeoutMs: remaining, signal: stopSignal },
                );
                deps.flushSteerBuffer();
                return { continue: true };
              }
            }

            // 2. After UpdateGoal marks a goal terminal, ask the model for one
            //    final user-facing outcome message before the turn ends.
            if (
              !goalOutcomeMessageContinuationUsed &&
              isGoalOutcomeReminderOrigin(agent.context.history.at(-1)?.origin)
            ) {
              goalOutcomeMessageContinuationUsed = true;
              if (!hasStepBudgetRemaining(loopControl?.maxStepsPerTurn, ctx.stepNumber)) {
                agent.context.popMatchedMessage(isGoalOutcomeReminderOrigin);
                return { continue: false };
              }
              return { continue: true };
            }

            // 3. The external Stop hook gets exactly one continuation; the cap
            //    is intentionally separate from (and does not cap) goal mode.
            if (!stopHookContinuationUsed) {
              const stopBlock = await agent.hooks?.triggerBlock('Stop', {
                signal: stopSignal,
                inputData: { stopHookActive: stopHookContinuationUsed },
              });
              stopSignal.throwIfAborted();
              if (stopBlock !== undefined) {
                stopHookContinuationUsed = true;
                agent.context.appendUserMessage(
                  [{ type: 'text', text: stopBlock.reason }],
                  {
                    kind: 'system_trigger',
                    name: 'stop_hook',
                  },
                );
                return { continue: true };
              }
            }

            // 4. Otherwise stop. Goal continuation is no longer driven here:
            //    each goal turn is an ordinary turn, and the goal driver decides
            //    whether to run another after this one ends.
            return { continue: false };
          },
          prepareToolExecution: async (ctx) => {
            const cached = deduper.checkSameStep(
              ctx.toolCall.id,
              ctx.toolCall.name,
              ctx.args,
            );
            if (cached !== null) return { syntheticResult: cached };
            return undefined;
          },
          authorizeToolExecution: async (ctx) => {
            return agent.permission.beforeToolCall(ctx);
          },
          finalizeToolResult: async (ctx) => {
            // Resolve dedup BEFORE firing the PostToolUse hook so same-step
            // dups (whose ctx.result is the dedup placeholder) report the
            // original's real outcome, not an empty success.
            const finalResult = await deduper.finalizeResult(
              ctx.toolCall.id,
              ctx.toolCall.name,
              ctx.args,
              ctx.result,
            );
            const { isError, output } = finalResult;
            observeVerificationToolResult(
              agent.verificationSensorLedger,
              ctx.toolCall.name,
              ctx.args,
              finalResult,
            );
            const event = isError === true ? 'PostToolUseFailure' : 'PostToolUse';
            void agent.hooks?.fireAndForgetTrigger(event, {
              matcherValue: ctx.toolCall.name,
              inputData: {
                toolName: ctx.toolCall.name,
                toolInput: toolInputRecord(ctx.args),
                toolCallId: ctx.toolCall.id,
                error: isError === true ? toKimiErrorPayload(toolOutputText(output)) : undefined,
                toolOutput: isError === true ? undefined : toolOutputText(output).slice(0, 2000),
              },
            });
            const budgeted = await budgetToolResultForModel({
              homedir: agent.homedir,
              toolName: ctx.toolCall.name,
              toolCallId: ctx.toolCall.id,
              result: finalResult,
              contextWindowTokens: agent.config.modelCapabilities.max_context_tokens,
            });
            return budgeted;
          },
        },
      });

      return result.stopReason;
    } catch (error) {
      const isContextOverflow =
        error instanceof APIContextOverflowError ||
        (isKimiError(error) && error.code === ErrorCodes.CONTEXT_OVERFLOW);
      const estimatedRequestTokens = isContextOverflow
        ? agent.fullCompaction.estimateCurrentRequestTokens()
        : undefined;
      if (
        isContextOverflow ||
        agent.fullCompaction.shouldRecoverFromContextOverflow(error, estimatedRequestTokens)
      ) {
        agent.fullCompaction.observeContextOverflow(
          estimatedRequestTokens ?? agent.fullCompaction.estimateCurrentRequestTokens(),
        );
        await agent.fullCompaction.handleOverflowError(signal, error);
        continue; // Retry with compacted context
      }
      if (isMaxStepsExceededError(error)) {
        agent.log.warn('turn hit max steps', {
          turnId,
          steps: turnTelemetry.currentStepForTurn(turnId),
          limit: isKimiError(error) ? error.details?.['maxSteps'] : undefined,
        });
      } else {
        agent.log.error('turn failed', { turnId, error });
      }
      throw error;
    }
  }
}
