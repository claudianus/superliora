/**
 * RPC method implementations for the Agent API.
 * Extracted from Agent class to reduce God Class size.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCodes, LioraError } from '#/errors/index';
import type { AgentAPI } from '#/rpc';
import type { PromisableMethods } from '../utils/types';
import { expandCommandArguments } from '../plugin/commands';
import type { PluginCommandOrigin } from './context';
import { buildSessionOAuthStatus } from '../runtime/session-oauth-status';
import {
  conductorCancelGoal,
  conductorCreateGoal,
  conductorGetGoal,
  conductorPauseGoal,
  conductorResumeGoal,
} from '../tools/builtin/goal/goal-desk-facade';
import { shouldDelegateGoalToDesk } from '../tools/builtin/goal/goal-desk';
import {
  delegateConductorPlanDesk,
  shouldDelegateToPlanDesk,
} from '../tools/builtin/planning/plan-desk';
import { resolvePlanModeKind } from '../tools/builtin/planning/resolve-plan-mode-kind';
import * as jobRpc from '../tools/builtin/job/job-rpc-api';
import { resolveSessionSmartRoute } from './routing';
import type { Agent } from './index';

export function createRpcMethods(agent: Agent): PromisableMethods<AgentAPI> {
  return {
    prompt: (payload) => {
      agent.turn.prompt(payload.input);
    },
    runShellCommand: (payload) => agent.tools.runShellCommand(payload.command, payload.commandId),
    cancelShellCommand: (payload) =>{  agent.tools.cancelShellCommand(payload.commandId); },
    steer: (payload) => {
      agent.telemetry.track('input_steer', { parts: payload.input.length });
      agent.turn.steer(payload.input);
    },
    cancel: (payload) => {
      if (agent.turn.hasActiveTurn) {
        agent.telemetry.track('cancel', { from: payload.source ?? 'streaming' });
      }
      agent.turn.cancel(payload.turnId, undefined, payload.source);
    },
    undoHistory: (payload) => {
      agent.context.undo(payload.count);
    },
    setThinking: (payload) => {
      const wasEnabled = agent.config.thinkingLevel !== 'off';
      agent.config.update({ thinkingLevel: payload.level });
      const enabled = agent.config.thinkingLevel !== 'off';
      if (enabled !== wasEnabled) {
        agent.telemetry.track('thinking_toggle', { enabled });
      }
    },
    setPermission: (payload) => {
      const wasYolo = agent.permission.mode === 'yolo';
      const wasAuto = agent.permission.mode === 'auto';
      agent.permission.setMode(payload.mode);
      const enabled = agent.permission.mode === 'yolo';
      if (enabled !== wasYolo) {
        agent.telemetry.track('yolo_toggle', { enabled });
      }
      const afkEnabled = agent.permission.mode === 'auto';
      if (afkEnabled !== wasAuto) {
        agent.telemetry.track('afk_toggle', { enabled: afkEnabled });
      }
    },
    setModel: (payload) => {
      // Virtual smart-auto pin — resolved per turn; do not require catalog resolve.
      const isSmartAuto = payload.model.trim().toLowerCase() === 'auto';
      if (isSmartAuto) {
        if (agent.config.modelAlias !== payload.model) {
          agent.config.update({ modelAlias: payload.model });
          agent.telemetry.track('model_switch', { model: payload.model });
        }
        const runtime = agent.runtimeConfig ?? agent.kimiConfig;
        if (runtime !== undefined) {
          const route = resolveSessionSmartRoute({ config: runtime });
          if (route !== undefined) {
            agent.config.setSmartRouteAlias(route.alias);
          }
        }
        const effective = agent.config.effectiveModelAlias;
        const resolved =
          effective !== undefined && effective !== 'auto'
            ? agent.modelProvider?.resolveProviderConfig(effective)
            : undefined;
        return {
          model: payload.model,
          providerName: resolved?.providerName,
        };
      }
      const resolved = agent.modelProvider?.resolveProviderConfig(payload.model);
      if (agent.config.modelAlias !== payload.model) {
        agent.config.update({ modelAlias: payload.model });
        agent.telemetry.track('model_switch', { model: payload.model });
      }
      return {
        model: payload.model,
        providerName: resolved?.providerName,
      };
    },
    getModel: () => {
      return agent.config.modelAlias ?? '';
    },
    enterPlan: async (payload) => {
      const routed = resolvePlanModeKind({
        ultra: payload.ultra,
        initialContext: payload.initialContext,
      });
      const useUltra = routed.kind === 'ultra';
      if (shouldDelegateToPlanDesk(agent, payload.initialContext)) {
        if (agent.planMode.isActive) {
          agent.planMode.cancel();
        }
        await delegateConductorPlanDesk(agent, {
          ultra: useUltra,
          initialContext: payload.initialContext,
        });
        return;
      }
      await agent.planMode.enter(undefined, false, true, useUltra, payload.initialContext ?? '');
    },
    cancelPlan: (payload) => {
      agent.planMode.cancel(payload.id);
    },
    clearPlan: () => agent.planMode.clear(),
    setAskMode: (payload) => agent.askMode.set(payload.enabled),
    getAskMode: () => agent.askMode.isActive,
    setPremiumQuality: (payload) => {
      agent.premiumQuality.setEnabled(payload.enabled);
    },
    getPremiumQuality: () => {
      return agent.premiumQuality.isEnabled();
    },
    beginCompaction: (payload) => {
      agent.fullCompaction.begin({ source: 'manual', instruction: payload.instruction });
    },
    cancelCompaction: () => {
      if (agent.fullCompaction.isCompacting) {
        agent.telemetry.track('cancel', { from: 'compacting' });
      }
      agent.fullCompaction.cancel();
    },
    refineHarness: (payload) => {
      if (agent.refine === null) {
        throw new LioraError(ErrorCodes.REQUEST_INVALID, 'Refine is only available on the main agent.');
      }
      return agent.refine.refine({
        ...(payload.scope !== undefined ? { scope: payload.scope } : {}),
        ...(payload.instructions !== undefined ? { instructions: payload.instructions } : {}),
      });
    },
    rollbackHarnessRefinement: (payload) => {
      if (agent.refine === null) {
        throw new LioraError(ErrorCodes.REQUEST_INVALID, 'Refine is only available on the main agent.');
      }
      return agent.refine.rollback(payload.refinementId);
    },
    getHarnessStatus: () => {
      if (agent.refine === null) {
        throw new LioraError(ErrorCodes.REQUEST_INVALID, 'Refine is only available on the main agent.');
      }
      return agent.refine.statusView();
    },
    registerTool: (payload) => {
      agent.tools.registerUserTool(payload);
    },
    unregisterTool: (payload) => {
      agent.tools.unregisterUserTool(payload.name);
    },
    setActiveTools: (payload) => {
      agent.tools.setActiveTools(payload.names);
    },
    stopBackground: (payload) => {
      void agent.background.stop(payload.taskId, payload.reason);
    },
    detachBackground: (payload) => agent.background.detach(payload.taskId),
    clearContext: () => {
      agent.context.clear();
    },
    activateSkill: async (payload) => {
      if (agent.skills === null) {
        throw new LioraError(ErrorCodes.SKILL_NOT_FOUND, `Skill "${payload.name}" was not found`);
      }
      await agent.skills.activate(payload);
    },
    activatePluginCommand: (payload) => {
      const def = agent.pluginCommands.find(
        (command) =>
          command.pluginId === payload.pluginId && command.name === payload.commandName,
      );
      if (def === undefined) {
        throw new LioraError(
          ErrorCodes.REQUEST_INVALID,
          `Plugin command "${payload.pluginId}:${payload.commandName}" was not found`,
        );
      }
      const commandArgs = payload.args ?? '';
      const origin: PluginCommandOrigin = {
        kind: 'plugin_command',
        activationId: randomUUID(),
        pluginId: payload.pluginId,
        commandName: payload.commandName,
        commandArgs: payload.args,
        trigger: 'user-slash',
      };
      agent.emitEvent({
        type: 'plugin_command.activated',
        activationId: origin.activationId,
        pluginId: origin.pluginId,
        commandName: origin.commandName,
        commandArgs: origin.commandArgs,
        trigger: origin.trigger,
      });
      agent.turn.prompt(
        [{ type: 'text', text: expandCommandArguments(def.body, commandArgs) }],
        origin,
      );
    },
    startBtw: () => agent.subagentHost!.startBtw(),
    createGoal: async (payload) => {
      if (shouldDelegateGoalToDesk(agent)) {
        return conductorCreateGoal(agent, payload);
      }
      return agent.goal.createGoal(payload);
    },
    getGoal: () => {
      if (shouldDelegateGoalToDesk(agent)) {
        return conductorGetGoal(agent);
      }
      return agent.goal.getGoal();
    },
    pauseGoal: () => {
      if (shouldDelegateGoalToDesk(agent)) {
        return conductorPauseGoal(agent);
      }
      return agent.goal.pauseGoal();
    },
    resumeGoal: async () => {
      if (shouldDelegateGoalToDesk(agent)) {
        return conductorResumeGoal(agent);
      }
      return agent.goal.resumeGoal();
    },
    cancelGoal: () => {
      if (shouldDelegateGoalToDesk(agent)) {
        return conductorCancelGoal(agent);
      }
      return agent.goal.cancelGoal();
    },
    jobList: () => jobRpc.jobList(agent.tools.getStore()),
    jobInspect: (payload) => jobRpc.jobInspect(agent.tools.getStore(), payload.jobId),
    jobInbox: (payload) =>
      jobRpc.jobInbox(agent.tools.getStore(), {
        markRead: payload.markRead,
        limit: payload.limit,
      }),
    jobSteer: (payload) =>
      jobRpc.jobSteer(agent.tools.getStore(), {
        jobId: payload.jobId,
        message: payload.message,
        status: payload.status,
        agent,
      }),
    jobCancel: (payload) =>
      jobRpc.jobCancel(agent.tools.getStore(), {
        jobId: payload.jobId,
        reason: payload.reason,
        agent,
      }),
    jobResume: (payload) =>
      jobRpc.jobResume(agent.tools.getStore(), {
        jobId: payload.jobId,
        answer: payload.answer,
        agent,
      }),
    jobCreate: (payload) => jobRpc.jobCreate(agent.tools.getStore(), payload, agent),
    jobCreateBatch: (payload) =>
      jobRpc.jobCreateBatch(agent.tools.getStore(), payload.jobs, agent),
    jobMerge: (payload) => jobRpc.jobMerge(agent.tools.getStore(), payload, agent),
    jobPreviewSplit: (payload) => jobRpc.jobPreviewSplit(payload.text),
    jobGcWorktrees: (payload) =>
      jobRpc.jobGcWorktrees(agent.tools.getStore(), { agent, dryRun: payload.dryRun }),
    jobSetProjectMode: (payload) =>
      jobRpc.jobSetProjectMode(agent.tools.getStore(), payload.mode),
    getBackgroundOutput: (payload) => agent.background.readOutput(payload.taskId, payload.tail),
    getContext: () => agent.context.data(),
    getContextComposition: () => agent.context.composition(),
    diagnoseContextOS: (payload) =>
      agent.contextOS.diagnose(payload.query ?? '', payload.limit),
    getConfig: () => agent.config.data(),
    getPermission: () => agent.permission.data(),
    getCircuitBreakers: () => agent.circuitBreakerStatus(),
    getCacheFrozen: () => agent.cacheFreezeGuard.isFrozen(),
    getCacheFreezeViolations: () => agent.cacheFreezeGuard.getViolationCount(),
    getParallelToolsStatus: () => agent.toolParallelStatus.snapshot(),
    getOAuthStatus: async () => {
      if (agent.kimiConfig === undefined || agent.homedir === undefined) {
        return undefined;
      }
      return buildSessionOAuthStatus({
        config: agent.kimiConfig,
        homeDir: agent.homedir,
        modelAlias: agent.config.data().modelAlias,
      });
    },
    getPlan: () => agent.planMode.data(),
    getUsage: () => agent.usage.status() ?? agent.usage.data(),
    getProviderRouteStatus: () => agent.providerRouteStatus(),
    getProviderExtrasStatus: () => agent.providerExtrasStatus(),
    resetProviderRouteStatus: () => agent.resetProviderRouteStatus(),
    getTools: () => agent.tools.data(),
    getBackground: (payload) => agent.background.list(payload.activeOnly ?? false, payload.limit),
    inlineComplete: (payload, options) =>
      agent.intelligence.inlineComplete({ ...payload, signal: options?.signal }),
    suggestPrompts: (_payload, options) =>
      agent.intelligence.suggestPrompts({ signal: options?.signal }),
  };
}
