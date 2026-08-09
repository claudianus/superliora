/**
 * Turn step loop — extracted from TurnFlow.
 *
 * Runs the agent loop for a single turn: goal injection, step hooks,
 * tool dedup/budgeting, stop-hook continuation, and context-overflow recovery.
 */

import {
  APIContextOverflowError,
  APIStatusError,
  parseStatedContextLimitTokens,
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
import {
  isCheckLikeBashCommand,
  isVerificationCheckTool,
  observeVerificationToolResult,
  surfaceProofAxesSatisfied,
} from '../../sensors/verification-sensor-ledger';
import {
  clearPendingMutations,
  clearUiSurfaceProofPending,
  extractMutationPathsFromToolArgs,
  deriveMutationPackageDir,
  isFileMutationTool,
  observeFileMutationToolResult,
} from '../../sensors/mutation-verification-sensor';
import {
  appendAutoCheckSpawnBlock,
  AUTO_CHECK_SPAWN_ERROR_CODE,
  decideAutoCheckSpawn,
  formatAutoCheckSpawnErrorTip,
  formatAutoCheckSpawnResult,
  recordAutoCheckSpawn,
  wasRecentAutoCheckSpawnOk,
} from '../../sensors/auto-check-sensor';
import {
  evaluateStopSensor,
  formatStopSensorWireTip,
  STOP_SENSOR_ORIGIN_NAME,
  STOP_SENSOR_WARNING_CODE,
} from '../../sensors/stop-sensor';
import {
  decideStepBudgetWarn,
  formatStepBudgetWarnTip,
  STEP_BUDGET_SENSOR_ORIGIN,
} from '../../sensors/step-budget-sensor';
import type { ExecutableToolResult } from '../../loop/types';
import {
  DOOMED_RUN_HARD_STOP_STREAK,
  DOOMED_RUN_WARN_ORIGIN,
  DOOMED_RUN_WARN_STREAK,
  formatDoomedRunWarnTip,
  hasDoomedRunWarnReminder,
  trailingToolErrorStreak,
} from './doomed-run-guard';
import {
  buildTurnPrefixMaterial,
  CACHE_FREEZE_DRIFT_SENSOR_ORIGIN,
  formatCacheFreezeDriftTip,
} from '../cache';
import { toolInputRecord, toolOutputText, type TurnTelemetry } from './telemetry';
import {
  hasStepBudgetRemaining,
  isGoalOutcomeReminderOrigin,
} from './goal-driver';
import type { createTurnLoopDispatch } from './loop-dispatch';
import { budgetToolResultForModel } from './tool-result-budget';
import { CONDUCTOR_GUARD_CODES } from '../conductor-guard';

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
  let stopSensorContinuationUsed = false;
  let goalOutcomeMessageContinuationUsed = false;
  // Loop22a: one soft tip when remaining steps ≤ threshold (plain turns).
  let stepBudgetWarnUsed = false;
  // Loop32a: one live notice when CacheFreezeGuard soft-detects mid-turn drift.
  let cacheFreezeDriftWarnUsed = false;
  // V1-4: set when the conductor hard-budget tripwire force-stops this turn;
  // continuation hooks must not resume a budget-stopped turn.
  let budgetTripStopUsed = false;
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
            // Goal budgets exclude cache-read tokens: those are repeated
            // context served from the provider cache, and counting them makes
            // long goal loops exhaust the budget far before the non-cached
            // work reaches the configured cap (Prime Agent parity).
            const snapshot = await agent.goal.recordTokenUsage(
              usage.inputOther + usage.inputCacheCreation + usage.output,
            );
            stopForGoalBudget = snapshot?.budget.overBudget === true;
          } catch (error) {
            agent.log.warn('goal token accounting failed', { error });
          }
        },
        hooks: {
          beforeStep: async ({ signal: stepSignal, stepNumber }) => {
            // Loop20a: soft re-check tool-list fingerprint every step (no throw —
            // ephemeral orchestrator tools may attach mid-session; setActiveTools
            // remains hard-blocked while frozen).
            if (
              !agent.cacheFreezeGuard.checkUnchanged(
                buildTurnPrefixMaterial(agent.tools.enabledTools),
                'tool list',
              )
            ) {
              const violations = agent.cacheFreezeGuard.getViolationCount();
              const label = agent.cacheFreezeGuard.getLastViolationLabel() ?? 'tool list';
              agent.log.warn('cache freeze tool list drifted mid-turn', {
                violations,
                label,
              });
              // Loop32a: status counters alone are easy to miss mid-turn — one wire warning.
              if (!cacheFreezeDriftWarnUsed) {
                cacheFreezeDriftWarnUsed = true;
                const tip = formatCacheFreezeDriftTip(violations, label);
                agent.emitEvent({
                  type: 'warning',
                  message: tip,
                  code: CACHE_FREEZE_DRIFT_SENSOR_ORIGIN,
                });
              }
            }
            // Settle in-flight (async) compaction before history-mutating hooks.
            // Otherwise flushSteer / micro cutoff / budget tips race the worker
            // and used to surface as spurious compaction.cancelled.
            if (agent.fullCompaction.isCompacting) {
              await agent.fullCompaction.beforeStep(stepSignal);
            }
            // Loop22a: soft step-budget early warning (one-shot per turn).
            const maxSteps = loopControl?.maxStepsPerTurn;
            if (typeof maxSteps === 'number' && maxSteps > 0) {
              const decision = decideStepBudgetWarn({
                step: stepNumber,
                maxSteps,
                alreadyWarned: stepBudgetWarnUsed,
              });
              if (decision.warn) {
                stepBudgetWarnUsed = true;
                const tip = formatStepBudgetWarnTip(decision);
                agent.context.appendUserMessage(
                  [{ type: 'text', text: tip }],
                  { kind: 'injection', variant: STEP_BUDGET_SENSOR_ORIGIN },
                );
                // Loop28b: also emit a wire warning so TUI can surface the soft tip
                // (injection alone is model-visible only).
                agent.emitEvent({
                  type: 'warning',
                  message: tip,
                  code: STEP_BUDGET_SENSOR_ORIGIN,
                });
              }
            }
            deps.flushSteerBuffer();
            // L1 (Claude Code micro / OpenCode prune): clear old tool dumps first.
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
            if (stopForGoalBudget) return { stopTurn: true };
            // E4 doomed-run guard: unattended runs must not burn their whole
            // budget on a losing streak. Warn once, then force-stop the turn.
            if (agent.type === 'sub') {
              const streak = trailingToolErrorStreak(agent.context.history);
              if (streak >= DOOMED_RUN_HARD_STOP_STREAK) {
                agent.log.warn('doomed run hard stop: consecutive tool failures', { streak });
                agent.telemetry.track('doomed_run_hard_stop', {
                  error_streak: streak,
                  profile: agent.config.profileName,
                });
                return { stopTurn: true };
              }
              if (
                streak >= DOOMED_RUN_WARN_STREAK &&
                !hasDoomedRunWarnReminder(agent.context.history)
              ) {
                agent.telemetry.track('doomed_run_warn', {
                  error_streak: streak,
                  profile: agent.config.profileName,
                });
                agent.context.appendUserMessage(
                  [{ type: 'text', text: formatDoomedRunWarnTip(streak) }],
                  { kind: 'injection', variant: DOOMED_RUN_WARN_ORIGIN },
                );
              }
            }
            return undefined;
          },
          // oxlint-disable-next-line no-loop-func -- stop hook continuation state is scoped to this turn.
          shouldContinueAfterStop: async (ctx) => {
            const { signal: stopSignal } = ctx;
            // V1-4: a conductor hard-budget trip stop is a forced stop — no
            // continuation (steered input, stop hook, or sensor) may resume it.
            if (budgetTripStopUsed) return { continue: false };
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

            // 4. Built-in Stop sensor (one-shot): sticky mutation/failure evidence
            //    without Goal hard gates still forces one repair continuation.
            //    Skip when a Goal is active — markComplete sensor gate owns that path.
            if (!stopSensorContinuationUsed) {
              const hasActiveGoal = agent.goal?.getGoal?.()?.goal?.status === 'active';
              const stopSensorBody = evaluateStopSensor({
                verificationLedger: agent.verificationSensorLedger,
                mutationLedger: agent.mutationVerificationLedger,
                skip: hasActiveGoal === true,
                // Loop20b: green spawn within cooldown window → no mutation-only stop.
                recentAutoCheckSpawnOk: wasRecentAutoCheckSpawnOk(
                  agent.autoCheckSpawnState,
                ),
              });
              if (stopSensorBody !== null) {
                stopSensorContinuationUsed = true;
                if (!hasStepBudgetRemaining(loopControl?.maxStepsPerTurn, ctx.stepNumber)) {
                  return { continue: false };
                }
                agent.context.appendUserMessage([{ type: 'text', text: stopSensorBody }], {
                  kind: 'system_trigger',
                  name: STOP_SENSOR_ORIGIN_NAME,
                });
                // Loop34a: operator-visible one-shot — injection alone is model-only.
                agent.emitEvent({
                  type: 'warning',
                  message: formatStopSensorWireTip(stopSensorBody),
                  code: STOP_SENSOR_WARNING_CODE,
                });
                return { continue: true };
              }
            }

            // 5. Otherwise stop. Goal continuation is no longer driven here:
            //    each goal turn is an ordinary turn, and the goal driver decides
            //    whether to run another after this one ends.
            return { continue: false };
          },
          prepareToolExecution: async (ctx) => {
            // Conductor delegation guard (contract §2.2 b-2): stage 1 rejects
            // file-mutation and worker-wait tools by name, then arms the
            // wall-clock tripwire budget for everything it allows.
            let executionSignal: AbortSignal | undefined;
            const conductorGuard = agent.conductorGuard;
            if (conductorGuard !== undefined) {
              const verdict = conductorGuard.evaluateToolCall({
                toolName: ctx.toolCall.name,
                args: ctx.args,
                turnId: ctx.turnId,
                stepNumber: ctx.stepNumber,
              });
              if (!verdict.allowed) {
                const syntheticResult: ExecutableToolResult =
                  verdict.stopTurn === true
                    ? { output: verdict.output, isError: true, stopTurn: true }
                    : { output: verdict.output, isError: true };
                return { syntheticResult };
              }
              // V1-4: hand the per-call budget signal to the loop so a hard
              // budget overrun force-stops the running call, not just records it.
              executionSignal = conductorGuard.beginToolBudget(
                ctx.toolCall.id,
                ctx.toolCall.name,
                ctx.turnId,
              );
            }
            const cached = deduper.checkSameStep(
              ctx.toolCall.id,
              ctx.toolCall.name,
              ctx.args,
            );
            if (cached !== null) return { syntheticResult: cached };
            return executionSignal === undefined ? undefined : { executionSignal };
          },
          authorizeToolExecution: async (ctx) => {
            // Conductor delegation guard stage 2: access-based judgment for
            // tools outside the known delegation/read surface (plugin/MCP/new
            // builtins). Runs before the permission policy so a rejection is
            // never relaxed downstream.
            const conductorGuard = agent.conductorGuard;
            if (conductorGuard !== undefined) {
              const verdict = conductorGuard.authorizeExecution({
                toolName: ctx.toolCall.name,
                execution: ctx.execution,
                turnId: ctx.turnId,
                stepNumber: ctx.stepNumber,
              });
              if (!verdict.allowed) {
                conductorGuard.endToolBudget(ctx.toolCall.id);
                return { block: true, reason: verdict.output };
              }
            }
            return agent.permission.beforeToolCall(ctx);
          },
          finalizeToolResult: async (ctx) => {
            // Settle the conductor wall-clock tripwire for this call, then
            // consume a pending hard-budget turn stop (three consecutive trips,
            // checklist V1-4) so the turn ends with the diagnostic report.
            agent.conductorGuard?.endToolBudget(ctx.toolCall.id);
            const budgetTripStopReport = agent.conductorGuard?.consumeBudgetTurnStop(ctx.turnId);
            if (budgetTripStopReport !== undefined) {
              budgetTripStopUsed = true;
              agent.emitEvent({
                type: 'warning',
                message: budgetTripStopReport,
                code: CONDUCTOR_GUARD_CODES.toolBudgetTripStop,
              });
            }
            // Resolve dedup BEFORE firing the PostToolUse hook so same-step
            // dups (whose ctx.result is the dedup placeholder) report the
            // original's real outcome, not an empty success.
            const finalResult = await deduper.finalizeResult(
              ctx.toolCall.id,
              ctx.toolCall.name,
              ctx.args,
              ctx.result,
            );
            observeVerificationToolResult(
              agent.verificationSensorLedger,
              ctx.toolCall.name,
              ctx.args,
              finalResult,
            );
            // Green verification tools OR check-like Bash clear sticky mutation soft evidence.
            if (
              finalResult.isError !== true &&
              (isVerificationCheckTool(ctx.toolCall.name) ||
                (ctx.toolCall.name === 'Bash' &&
                  isCheckLikeBashCommand(toolInputRecord(ctx.args)['command'])))
            ) {
              clearPendingMutations(agent.mutationVerificationLedger);
            }
            // UI surface sticky proof clears only on full VerifySurface 3-axis pass.
            if (
              ctx.toolCall.name === 'VerifySurface' &&
              finalResult.isError !== true &&
              surfaceProofAxesSatisfied(agent.verificationSensorLedger)
            ) {
              clearUiSurfaceProofPending(agent.mutationVerificationLedger);
            }
            // Phase B: Edit/Write/ApplyPatch success → verify nudge + pending ledger.
            // Loop13: pass tool args so package-scoped RunProjectChecks tips work.
            let withMutationSensor = observeFileMutationToolResult(
              agent.mutationVerificationLedger,
              ctx.toolCall.name,
              finalResult,
              toolInputRecord(ctx.args),
            );
            // Loop19a: opt-in rate-limited RunProjectChecks spawn (env SUPERLIORA_AUTO_CHECK_SPAWN=1).
            withMutationSensor = await maybeAutoSpawnProjectChecks({
              agent,
              toolName: ctx.toolCall.name,
              toolArgs: toolInputRecord(ctx.args),
              result: withMutationSensor,
              signal: ctx.signal,
            });
            const { isError, output } = withMutationSensor;
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
            // Bound model-visible tool bodies; full output spills to disk with a
            // receipt + head/tail preview so context cannot grow without limit.
            const budgeted = await budgetToolResultForModel({
              homedir: agent.homedir,
              toolName: ctx.toolCall.name,
              toolCallId: ctx.toolCall.id,
              result: withMutationSensor,
              contextWindowTokens: agent.config.modelCapabilities.max_context_tokens,
            });
            if (budgetTripStopReport === undefined) return budgeted;
            // Forced turn stop: mark the final result so the loop ends the
            // turn and the model sees the tripwire diagnostic.
            const budgetedText = toolOutputText(budgeted.output);
            return {
              ...budgeted,
              isError: true,
              stopTurn: true,
              output:
                budgetedText.length > 0
                  ? `${budgetedText}\n\n${budgetTripStopReport}`
                  : budgetTripStopReport,
            };
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
        const errorMessage =
          error instanceof Error
            ? error.message
            : error instanceof APIStatusError
              ? error.message
              : String(error);
        const statedLimit = parseStatedContextLimitTokens(errorMessage);
        agent.fullCompaction.observeContextOverflow(
          estimatedRequestTokens ?? agent.fullCompaction.estimateCurrentRequestTokens(),
          statedLimit,
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

/**
 * Loop19a: after a successful file mutation, optionally spawn RunProjectChecks
 * when SUPERLIORA_AUTO_CHECK_SPAWN=1 and rate limits allow. Appends a compact
 * result block under the PostToolUse nudge. Never throws into the tool path.
 */
async function maybeAutoSpawnProjectChecks(input: {
  readonly agent: Agent;
  readonly toolName: string;
  readonly toolArgs: Record<string, unknown>;
  readonly result: ExecutableToolResult;
  readonly signal: AbortSignal;
}): Promise<ExecutableToolResult> {
  const { agent, toolName, toolArgs, result, signal } = input;
  if (result.isError === true || !isFileMutationTool(toolName)) {
    return result;
  }
  const paths = extractMutationPathsFromToolArgs(toolName, toolArgs);
  const packageDir = deriveMutationPackageDir(paths);
  const decision = decideAutoCheckSpawn({
    state: agent.autoCheckSpawnState,
    packageDir,
    env: process.env,
  });
  if (!decision.spawn) {
    return result;
  }

  const tool = agent.tools.builtinTools.get('RunProjectChecks');
  const textBefore = toolOutputText(result.output);

  // Loop40a: missing tool was a silent no-op when SUPERLIORA_AUTO_CHECK_SPAWN=1.
  if (tool === undefined) {
    const tip = formatAutoCheckSpawnErrorTip('RunProjectChecks tool not available');
    agent.emitEvent({
      type: 'warning',
      message: tip,
      code: AUTO_CHECK_SPAWN_ERROR_CODE,
    });
    return { ...result, output: appendAutoCheckSpawnBlock(textBefore, tip) };
  }

  try {
    const resolved = await tool.resolveExecution({
      packageDir: decision.packageDir,
      checks: [...decision.checks] as Array<
        'test' | 'typecheck' | 'build' | 'smoke' | 'lint'
      >,
    });
    // ToolExecution = RunnableToolExecution | ExecutableToolErrorResult.
    // Narrow on `execute` presence — RunnableToolExecution.isError is only `false|undefined`.
    if (!('execute' in resolved) || typeof resolved.execute !== 'function') {
      const errBody =
        'isError' in resolved && resolved.isError === true
          ? toolOutputText(resolved.output)
          : 'RunProjectChecks resolveExecution failed';
      recordAutoCheckSpawn(agent.autoCheckSpawnState, Date.now(), { ok: false });
      const block = formatAutoCheckSpawnResult({
        packageDir: decision.packageDir,
        checks: decision.checks,
        isError: true,
        outputText: errBody,
      });
      return { ...result, output: appendAutoCheckSpawnBlock(textBefore, block) };
    }

    const checkResult = await resolved.execute({
      turnId: 'auto-check-spawn',
      toolCallId: 'auto-check-spawn',
      signal,
    });
    const spawnOk = checkResult.isError !== true;
    recordAutoCheckSpawn(agent.autoCheckSpawnState, Date.now(), { ok: spawnOk });
    if (spawnOk) {
      clearPendingMutations(agent.mutationVerificationLedger);
    }
    const body = toolOutputText(checkResult.output);
    const block = formatAutoCheckSpawnResult({
      packageDir: decision.packageDir,
      checks: decision.checks,
      isError: checkResult.isError === true,
      outputText: body,
    });
    // Keep mutation-tool success/error as-is; only append the check report.
    return { ...result, output: appendAutoCheckSpawnBlock(textBefore, block) };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    agent.log.warn('auto-check spawn failed', {
      packageDir: decision.packageDir,
      error: errMsg,
    });
    // Still count the attempt so a broken tool cannot tight-loop.
    recordAutoCheckSpawn(agent.autoCheckSpawnState, Date.now(), { ok: false });
    // Loop40a: ERROR tip + wire warning so TUI surfaces spawn exceptions.
    const tip = formatAutoCheckSpawnErrorTip(errMsg);
    agent.emitEvent({
      type: 'warning',
      message: tip,
      code: AUTO_CHECK_SPAWN_ERROR_CODE,
    });
    return { ...result, output: appendAutoCheckSpawnBlock(textBefore, tip) };
  }
}
