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
import {
  hasPendingUltraSwarmRestaff,
  requestUltraSwarmSteer,
} from './ultra-swarm-run';
import {
  detectUltraworkAutoActivationWithLlm,
  shouldActOnUltraworkAutoActivation,
} from '#/mission';
import {
  detectUltraworkObjectiveProfileWithLlm,
  fallbackUltraworkObjectiveProfile,
  resolveUltraworkObjectiveProfile,
} from '#/mission';
import { buildSessionOAuthStatus } from '../runtime/session-oauth-status';
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
      // During UltraSwarm, route steers into the swarm checkpoint queue.
      if (agent.ultraSwarmRun !== undefined) {
        const text = payload.input
          .map((part) => ('text' in part ? String(part.text ?? '') : ''))
          .join('\n')
          .trim();
        if (requestUltraSwarmSteer(agent.ultraSwarmRun, text)) {
          agent.records.logRecord({ type: 'swarm.steer', input: text });
          // Restaff steers force a restaff wave — do not pause the phase loop.
          if (hasPendingUltraSwarmRestaff(agent.ultraSwarmRun)) {
            agent.telemetry.track('ultra_swarm_restaff_requested', {
              run_id: agent.ultraSwarmRun.runId,
              source: 'steer',
            });
            agent.emitEvent({
              type: 'ultrawork.swarm.restaff_requested',
              runId: agent.ultraSwarmRun.runId,
              reason: text,
            } as any);
            return;
          }
          agent.forwardSteerToRunningChildren(text);
          void agent.ultrawork.pause({ reason: 'User steering requested during UltraSwarm' });
          agent.emitEvent({
            type: 'ultrawork.swarm.paused',
            runId: agent.ultraSwarmRun.runId,
            reason: 'User steering requested',
            input: text,
          } as any);
          return;
        }
      }
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
      await agent.planMode.enter(
        undefined,
        false,
        true,
        payload.ultra ?? false,
        payload.initialContext ?? '',
        payload.source ?? 'standalone',
      );
    },
    cancelPlan: (payload) => {
      agent.planMode.cancel(payload.id);
    },
    clearPlan: () => agent.planMode.clear(),
    enterSwarm: (payload) => {
      agent.swarmMode.enter(payload.trigger);
    },
    exitSwarm: () => {
      agent.swarmMode.exit();
    },
    getSwarmMode: () => {
      return agent.swarmMode.isActive;
    },
    setPremiumQuality: (payload) => {
      agent.premiumQuality.setEnabled(payload.enabled);
    },
    getPremiumQuality: () => {
      return agent.premiumQuality.isEnabled();
    },
    setOrchestratorMode: (payload) => {
      agent.setOrchestratorMode(payload.enabled);
    },
    getOrchestratorMode: () => {
      return agent.orchestratorMode;
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
    createUltraworkRun: (payload) =>
      agent.ultrawork.create({
        id: payload.id,
        objective: payload.objective,
        activation: {
          source: payload.source,
          replaceGoal: payload.replaceGoal,
          evidenceRoot: payload.evidenceRoot,
          workDir: payload.workDir,
        },
      }),
    getUltraworkRun: () => agent.ultrawork.getRun(),
    pauseUltrawork: (payload) => {
      // War-room / action-dock pause must also stop UltraSwarm phase advancement.
      if (agent.ultraSwarmRun !== undefined) {
        agent.ultraSwarmRun.pausedForSteer = true;
        agent.telemetry.track('ultra_swarm_pause_requested', {
          run_id: agent.ultraSwarmRun.runId,
          source: 'pause_ultrawork',
          reason:
            typeof payload.reason === 'string' && payload.reason.trim().length > 0
              ? payload.reason.trim().slice(0, 240)
              : undefined,
        });
        agent.emitEvent({
          type: 'ultrawork.swarm.paused',
          runId: agent.ultraSwarmRun.runId,
          reason:
            typeof payload.reason === 'string' && payload.reason.trim().length > 0
              ? payload.reason
              : 'Paused from Ultrawork pause',
        } as any);
      }
      return agent.ultrawork.pause(payload);
    },
    resumeUltrawork: () => {
      // Clear UltraSwarm phase pause when Ultrawork resumes so the next wave can run.
      if (agent.ultraSwarmRun !== undefined) {
        agent.ultraSwarmRun.pausedForSteer = false;
      }
      return agent.ultrawork.resume();
    },
    cancelUltrawork: (payload) => agent.ultrawork.cancel(payload.reason),
    swarmRestaff: (payload) =>
      agent.swarmRestaff(
        typeof payload.reason === 'string' && payload.reason.trim().length > 0
          ? payload.reason
          : 'User requested restaff',
      ),
    classifyUltraworkAutoActivation: async (payload) => {
      const text = payload.text.trim();
      if (text.length === 0) {
        return { activate: false, confidence: 1, reason: 'Empty prompt' };
      }
      const provider = agent.config.provider;
      if (provider === undefined || typeof agent.generate !== 'function') {
        return {
          activate: false,
          confidence: 0,
          reason: 'LLM provider unavailable for Ultrawork auto-activation',
        };
      }
      const intent = await detectUltraworkAutoActivationWithLlm(
        { generate: agent.generate, provider },
        { text, signal: AbortSignal.timeout(8_000) },
      );
      const activate = shouldActOnUltraworkAutoActivation(intent);
      return {
        activate,
        confidence: intent?.confidence ?? 0,
        reason: intent?.reason ?? 'Ultrawork auto-activation declined or unavailable',
      };
    },
    classifyUltraworkObjectiveProfile: async (payload) => {
      const text = payload.text.trim();
      if (text.length === 0) {
        return fallbackUltraworkObjectiveProfile('');
      }
      const provider = agent.config.provider;
      if (provider === undefined || typeof agent.generate !== 'function') {
        const fallback = fallbackUltraworkObjectiveProfile(
          text,
          'LLM provider unavailable for Ultrawork objective profile',
        );
        agent.ultraworkObjectiveProfile.set(text, fallback);
        return fallback;
      }
      const detected = await detectUltraworkObjectiveProfileWithLlm(
        { generate: agent.generate, provider },
        { text, signal: AbortSignal.timeout(8_000) },
      );
      const profile = resolveUltraworkObjectiveProfile(detected, text);
      agent.ultraworkObjectiveProfile.set(text, profile);
      return profile;
    },
    getBackgroundOutput: (payload) => agent.background.readOutput(payload.taskId, payload.tail),
    getContext: () => agent.context.data(),
    getContextComposition: () => agent.context.composition(),
    diagnoseContextOS: (payload) =>
      agent.contextOS.diagnose(payload.query ?? '', payload.limit),
    getConfig: () => agent.config.data(),
    getPermission: () => agent.permission.data(),
    getCircuitBreakers: () => agent.circuitBreakerStatus(),
    getCacheFrozen: () => agent.cacheFreezeGuard.isFrozen(),
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
    resetProviderRouteStatus: () => agent.resetProviderRouteStatus(),
    getTools: () => agent.tools.data(),
    getBackground: (payload) => agent.background.list(payload.activeOnly ?? false, payload.limit),
    inlineComplete: (payload, options) =>
      agent.intelligence.inlineComplete({ ...payload, signal: options?.signal }),
    suggestPrompts: (_payload, options) =>
      agent.intelligence.suggestPrompts({ signal: options?.signal }),
  };
}
