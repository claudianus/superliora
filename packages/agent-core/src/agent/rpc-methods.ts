/**
 * RPC method implementations for the Agent API.
 * Extracted from Agent class to reduce God Class size.
 */
import type { AgentAPI } from '#/rpc';
import type { PromisableMethods } from '../utils/types';
import { buildSessionOAuthStatus } from '../runtime/session-oauth-status';
import * as jobRpc from '../tools/builtin/job/job-rpc-api';
import { resolveConfiguredSessionRoute } from './routing';
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
      const runtime = agent.runtimeConfig ?? agent.kimiConfig;
      const model = runtime === undefined ? payload.model
        : resolveConfiguredSessionRoute({ config: runtime, alias: payload.model }).alias;
      const resolved = agent.modelProvider?.resolveProviderConfig(model);
      if (agent.config.modelAlias !== model) {
        agent.config.update({ modelAlias: model });
        agent.telemetry.track('model_switch', { model });
      }
      return { model, providerName: resolved?.providerName };
    },
    getModel: () => {
      return agent.config.modelAlias ?? '';
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
    stopBackground: async (payload) => { await agent.background.stop(payload.taskId, payload.reason); },
    detachBackground: (payload) => agent.background.detach(payload.taskId),
    clearContext: () => {
      agent.context.clear();
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
    jobPause: (payload) =>
      jobRpc.jobPause(agent.tools.getStore(), { ...payload, agent }),
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
    jobPush: (payload) => jobRpc.jobPush(agent.tools.getStore(), payload, agent),
    jobPreviewSplit: (payload) => jobRpc.jobPreviewSplit(payload.text),
    jobGcWorktrees: (payload) =>
      jobRpc.jobGcWorktrees(agent.tools.getStore(), { agent, dryRun: payload.dryRun }),
    jobSetProjectMode: (payload) =>
      jobRpc.jobSetProjectMode(agent.tools.getStore(), payload.mode),
    jobWorkspaceCatalog: (payload) =>
      jobRpc.jobWorkspaceCatalog(agent.tools.getStore(), {
        workDir: payload.workDir ?? agent.config.cwd,
      }),
    jobAdoptWorkspace: (payload) =>
      jobRpc.jobAdoptWorkspaceSession(agent.tools.getStore(), {
        jobId: payload.jobId,
        workDir: agent.config.cwd,
        agent,
      }),
    jobArchiveWorkspace: (payload) =>
      jobRpc.jobArchiveWorkspaceSession(agent.tools.getStore(), {
        jobId: payload.jobId,
        workDir: agent.config.cwd,
      }),
    jobRenameWorkspace: (payload) =>
      jobRpc.jobRenameWorkspaceSession(agent.tools.getStore(), {
        jobId: payload.jobId,
        name: payload.name,
        workDir: agent.config.cwd,
      }),
    jobLandChoice: (payload) =>
      jobRpc.jobChooseLand(agent.tools.getStore(), payload, agent),
    getBackgroundOutput: (payload) => agent.background.readOutput(payload.taskId, payload.tail),
    getContext: () => agent.context.data(),
    getContextComposition: () => agent.context.composition(),
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
    getUsage: () => agent.usage.status() ?? agent.usage.data(),
    getProviderRouteStatus: () => agent.providerRouteStatus(),
    resetProviderRouteStatus: () => agent.resetProviderRouteStatus(),
    getBackground: (payload) => agent.background.list(payload.activeOnly ?? false, payload.limit),
  };
}
