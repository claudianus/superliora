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
  delegateConductorPlanDesk,
  shouldDelegateToPlanDesk,
} from '../tools/builtin/planning/plan-desk';
import { resolvePlanModeKind } from '../tools/builtin/planning/resolve-plan-mode-kind';
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
      // Validate the alias resolves before recording it so resume / runtime
      // callers fail fast on missing aliases instead of deferring to the
      // next prompt.
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
    createGoal: (payload) => agent.goal.createGoal(payload),
    getGoal: () => agent.goal.getGoal(),
    pauseGoal: () => agent.goal.pauseGoal(),
    resumeGoal: () => agent.goal.resumeGoal(),
    cancelGoal: () => agent.goal.cancelGoal(),
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
