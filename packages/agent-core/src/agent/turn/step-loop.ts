import type { Agent } from '..';
import { runTurn, type LoopEventDispatcher, type LoopTurnStopReason } from '../../loop/index';
import { buildTurnToolBlockMaterial } from '../cache';
import { budgetToolResultForModel } from './tool-result-budget';

export interface StepLoopDeps {
  readonly agent: Agent;
  readonly flushSteerBuffer: () => boolean;
  readonly buildDispatchEvent: (turnId: number) => LoopEventDispatcher;
}

export async function runTurnStepLoop(
  deps: StepLoopDeps,
  turnId: number,
  signal: AbortSignal,
): Promise<LoopTurnStopReason> {
  const { agent } = deps;
  const model = agent.config.model;
  const result = await runTurn({
    turnId: String(turnId),
    signal,
    llm: agent.llm,
    buildMessages: () => agent.context.messages,
    dispatchEvent: deps.buildDispatchEvent(turnId),
    tools: agent.tools.loopTools,
    log: agent.log,
    maxSteps: agent.kimiConfig?.loopControl?.maxStepsPerTurn,
    toolParallelStatus: agent.toolParallelStatus,
    recordStepUsage: (usage, info) => {
      const usageModel = info?.model ?? model;
      agent.usage.record(usageModel, usage, 'turn');
      agent.usage.recordCacheDiagnostics(
        agent.tools.loopTools,
        agent.context.history.length,
        usage,
        usageModel,
      );
    },
    hooks: {
      beforeStep: async ({ signal: stepSignal }) => {
        stepSignal.throwIfAborted();
        deps.flushSteerBuffer();
        agent.cacheFreezeGuard.checkUnchanged(
          buildTurnToolBlockMaterial(agent.tools.loopTools),
          'tool list',
        );
      },
      consumePendingInput: () => deps.flushSteerBuffer(),
      authorizeToolExecution: (ctx) => agent.permission.beforeToolCall(ctx),
      finalizeToolResult: (ctx) => budgetToolResultForModel({
        homedir: agent.homedir,
        toolName: ctx.toolCall.name,
        toolCallId: ctx.toolCall.id,
        result: ctx.result,
        contextWindowTokens: agent.config.modelCapabilities.max_context_tokens,
      }),
    },
  });
  return result.stopReason;
}
