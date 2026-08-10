import type { ChatProvider, ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import { ProviderManager } from '../../session/provider/provider-manager';
import {
  analyzeMediaPart,
  modelSupportsMediaKind,
} from '../../session/vision-analyzer';
import { extendWorkspaceWithSkillRoots } from '../../skill/scanner';
import * as b from '../../tools/builtin';
import { createVisualDiffTool } from '../../tools/visual-diff-tool';
import type { ToolStore } from '../../tools/store';
import { resolveMediaProviderEnv } from '../../tools/builtin/media/provider-env';
import { DEFAULT_AGENT_PROFILES } from '../../profile';
import {
  HIDE_LEGACY_TOOL_NAMES_ENV,
  isHideLegacyToolNamesEnabled,
} from '../../profile/sovereign-soft-gates';
import type { BuiltinTool } from './types';

export { HIDE_LEGACY_TOOL_NAMES_ENV, isHideLegacyToolNamesEnabled };

export interface BuiltinToolsHost {
  readonly agent: Agent;
  readonly enabledTools: ReadonlySet<string>;
  readonly toolStore: ToolStore;
}

/**
 * When no active profile tools are set yet (bootstrap / tests), create the
 * full builtin set. Once setActiveTools runs, only the active profile tools
 * are instantiated.
 */
export function shouldCreateBuiltin(host: BuiltinToolsHost, name: string): boolean {
  if (host.enabledTools.size === 0) return true;
  return host.enabledTools.has(name);
}

/**
 * Register a legacy compat alias only when the profile or bootstrap set asks for
 * it. Hide-legacy is the product default; omit the alias whenever the sovereign
 * twin would also register — keeps journal replay working when the legacy name is
 * explicitly selected. Opt out via SUPERLIORA_SHOW_LEGACY_TOOL_NAMES=1.
 */
export function shouldRegisterLegacyCompat(
  host: BuiltinToolsHost,
  legacyName: string,
  sovereignName: string,
): boolean {
  if (!shouldCreateBuiltin(host, legacyName)) return false;
  if (!isHideLegacyToolNamesEnabled()) return true;
  if (host.enabledTools.size > 0 && host.enabledTools.has(legacyName)) return true;
  return !shouldCreateBuiltin(host, sovereignName);
}

/**
 * V1-3 escalation wiring: the conductor guard records the blocked work as a
 * `queued` Job draft straight into the ledger on the second violation of a
 * turn. The guard can be constructed before tool stores exist, so the ledger
 * sink is attached here, where both sides are reachable. No-op off the
 * conductor lane.
 */
function wireConductorGuardLedgerRecording(host: BuiltinToolsHost): void {
  const guard = host.agent.conductorGuard;
  if (guard === undefined) return;
  guard.setJobDraftRecorder(b.createConductorJobDraftRecorder(host.toolStore));
}

export function buildBuiltinTools(host: BuiltinToolsHost): Map<string, BuiltinTool> {
  wireConductorGuardLedgerRecording(host);
  const {
    kaos,
    toolServices,
    config: { cwd, provider, modelCapabilities },
    background,
  } = host.agent;
  const videoUploader = createVideoUploader(host.agent, provider);
  const workspace = extendWorkspaceWithSkillRoots(
    {
      workspaceDir: cwd,
      additionalDirs: host.agent.getAdditionalDirs(),
      sandboxProfile: host.agent.sandboxProfile,
    },
    host.agent.skills?.registry.getSkillRoots() ?? [],
  );
  const allowBackground =
    host.enabledTools.has('TaskList') &&
    host.enabledTools.has('TaskOutput') &&
    host.enabledTools.has('TaskStop');
  // Goal tools normally belong to the main lane only; a worker profile that
  // explicitly whitelists them (goal-driver, spec 2026-08-04-goal-driver-jobs)
  // earns the pair so a runtime-migrated goal can be inspected and closed.
  const goalToolsEnabled =
    host.agent.type === 'main' ||
    (host.enabledTools.has('GetGoal') && host.enabledTools.has('UpdateGoal'));
  return new Map(
    [
      ...createFileAndContextTools(
        host,
        kaos,
        workspace,
        cwd,
        background,
        allowBackground,
        modelCapabilities,
        videoUploader,
      ),
      ...createPlanningGoalAndStateTools(host, background, goalToolsEnabled),
      ...createSkillAndSubagentTools(host, background, allowBackground),
      ...createGuiAndWebTools(host, toolServices),
    ]
      .filter((tool) => !!tool)
      .map((tool) => [tool.name, tool] as const),
  );
}

function createFileAndContextTools(
  host: BuiltinToolsHost,
  kaos: Agent['kaos'],
  workspace: {
    workspaceDir: string;
    additionalDirs: readonly string[];
    sandboxProfile?: Agent['sandboxProfile'];
  },
  cwd: string,
  background: Agent['background'],
  allowBackground: boolean,
  modelCapabilities: Agent['config']['modelCapabilities'],
  videoUploader: b.VideoUploader | undefined,
): Array<BuiltinTool | false | undefined> {
  const readMediaVisionFallback = buildReadMediaVisionFallback(host.agent);
  return [
    shouldCreateBuiltin(host, 'Read') && new b.ReadTool(kaos, workspace),
    shouldCreateBuiltin(host, 'Write') &&
      new b.WriteTool(kaos, workspace, {
        fileSnapshots: host.agent.fileSnapshots,
        getTurnId: () =>
          host.agent.turn.currentId !== undefined ? String(host.agent.turn.currentId) : undefined,
        getSwarmLease: () => host.agent.swarmFileLease,
        onFileMutated: (path, content) => host.agent.fileMutationHook?.(path, content),
      }),
    shouldCreateBuiltin(host, 'Edit') &&
      new b.EditTool(kaos, workspace, {
        fileSnapshots: host.agent.fileSnapshots,
        getTurnId: () =>
          host.agent.turn.currentId !== undefined ? String(host.agent.turn.currentId) : undefined,
        getSwarmLease: () => host.agent.swarmFileLease,
        onFileMutated: (path, content) => host.agent.fileMutationHook?.(path, content),
      }),
    shouldCreateBuiltin(host, 'ApplyPatch') &&
      new b.ApplyPatchTool(kaos, workspace, {
        fileSnapshots: host.agent.fileSnapshots,
        getTurnId: () =>
          host.agent.turn.currentId !== undefined ? String(host.agent.turn.currentId) : undefined,
        getSwarmLease: () => host.agent.swarmFileLease,
        onFileMutated: (path, content) => host.agent.fileMutationHook?.(path, content),
      }),
    shouldCreateBuiltin(host, 'Grep') && new b.GrepTool(kaos, workspace, host.agent.telemetry),
    shouldCreateBuiltin(host, 'Glob') && new b.GlobTool(kaos, workspace, host.agent.telemetry),
    shouldCreateBuiltin(host, 'RepoQuery') && new b.RepoQueryTool(kaos, workspace, host.agent.telemetry),
    shouldCreateBuiltin(host, 'LioraRead') && new b.LioraReadTool(kaos, workspace, host.toolStore),
    shouldCreateBuiltin(host, 'LioraTree') && new b.LioraTreeTool(kaos, workspace),
    shouldCreateBuiltin(host, 'LioraSymbol') && new b.LioraSymbolTool(kaos, workspace),
    shouldCreateBuiltin(host, 'LioraCallgraph') && new b.LioraCallgraphTool(kaos, workspace),
    shouldCreateBuiltin(host, 'Expand') && b.createExpandTool(host.toolStore),
    shouldCreateBuiltin(host, 'Compact') && new b.CompactTool(host.agent),
    // Refine is main-only: subagents carry no harness state to edit (the
    // service is null there), so don't spend their schema budget on it.
    shouldCreateBuiltin(host, 'Refine') &&
      host.agent.type === 'main' &&
      new b.RefineTool(host.agent),
    shouldCreateBuiltin(host, 'Bash') &&
      new b.BashTool(kaos, cwd, background, {
        allowBackground,
        store: host.toolStore,
        pathPrefix: host.agent.pluginBinDirs,
        isWorker: host.agent.type !== 'main',
      }),
    shouldCreateBuiltin(host, 'Script') && new b.ScriptTool(host.agent, kaos),
    shouldCreateBuiltin(host, 'RunProjectChecks') &&
      new b.RunProjectChecksTool(kaos, cwd, { store: host.toolStore }),
    shouldCreateBuiltin(host, 'ReadMediaFile') &&
      (modelCapabilities.image_in ||
        modelCapabilities.video_in ||
        readMediaVisionFallback !== undefined) &&
      new b.ReadMediaFileTool(
        kaos,
        workspace,
        modelCapabilities,
        videoUploader,
        readMediaVisionFallback,
      ),
    shouldCreateBuiltin(host, 'GenerateImage') &&
      b.isGenerateImageAvailable(resolveMediaProviderEnvForAgent(host.agent)) &&
      new b.GenerateImageTool(kaos, workspace, resolveMediaProviderEnvForAgent(host.agent)),
    shouldCreateBuiltin(host, 'GenerateVideo') &&
      b.isGenerateVideoAvailable(resolveMediaProviderEnvForAgent(host.agent)) &&
      new b.GenerateVideoTool(kaos, workspace, resolveMediaProviderEnvForAgent(host.agent)),
    shouldRegisterLegacyCompat(host, 'LioraReview', 'Review') &&
      b.createLioraReviewTool(kaos, host.agent),
    shouldCreateBuiltin(host, 'Review') && b.createReviewTool(kaos, host.agent),
    shouldCreateBuiltin(host, 'VisualDiff') && createVisualDiffTool(kaos),
  ];
}

/**
 * Vision analyzer fallback for ReadMediaFile on text-only models.
 * Undefined when policy is 'block' or no provider manager is attached;
 * 'path' returns a closure that yields undefined so the tool emits a
 * path-only note; 'analyze' renders the media with a vision model.
 */
function buildReadMediaVisionFallback(agent: Agent): b.ReadMediaVisionFallback | undefined {
  const providerManager = agent.modelProvider;
  if (!(providerManager instanceof ProviderManager)) return undefined;
  const policy = agent.kimiConfig?.media?.nonVisionFallback ?? 'analyze';
  if (policy === 'block') return undefined;
  return async ({ kind, dataUrl }) => {
    if (policy !== 'analyze') return undefined;
    const part: ContentPart =
      kind === 'video'
        ? { type: 'video_url', videoUrl: { url: dataUrl } }
        : { type: 'image_url', imageUrl: { url: dataUrl } };
    const result = await analyzeMediaPart(
      {
        generate: agent.generate,
        providerManager,
        currentModelAlias: agent.config.modelAlias,
        currentCapabilities: agent.config.modelCapabilities,
      },
      part,
    );
    return result?.text;
  };
}

function resolveVerifySurfaceMediaOptions(agent: Agent): {
  readonly attachScreenshotImage?: boolean;
  readonly visionFallback?: b.VerifySurfaceVisionFallback;
} {
  if (modelSupportsMediaKind(agent.config.modelCapabilities, 'image')) {
    return { attachScreenshotImage: true };
  }
  const visionFallback = buildVerifySurfaceVisionFallback(agent);
  return visionFallback === undefined ? {} : { visionFallback };
}

function buildVerifySurfaceVisionFallback(
  agent: Agent,
): b.VerifySurfaceVisionFallback | undefined {
  const providerManager = agent.modelProvider;
  if (!(providerManager instanceof ProviderManager)) return undefined;
  const policy = agent.kimiConfig?.media?.nonVisionFallback ?? 'analyze';
  if (policy === 'block') return undefined;
  return async ({ mimeType, base64, screenshotPath, signal }) => {
    if (policy !== 'analyze') return undefined;
    const result = await analyzeMediaPart(
      {
        generate: agent.generate,
        providerManager,
        currentModelAlias: agent.config.modelAlias,
        currentCapabilities: agent.config.modelCapabilities,
        signal,
      },
      {
        type: 'image_url',
        imageUrl: { url: `data:${mimeType};base64,${base64}` },
      },
      {
        originalPath: screenshotPath,
        label: 'VerifySurface screenshot',
      },
    );
    return result?.text;
  };
}

function resolveMediaProviderEnvForAgent(agent: Agent): b.GenerateImageProviderEnv & b.GenerateVideoProviderEnv {
  return resolveMediaProviderEnv({
    toolServices: agent.toolServices,
    kimiConfig: agent.kimiConfig,
  });
}

function createPlanningGoalAndStateTools(
  host: BuiltinToolsHost,
  background: Agent['background'],
  goalToolsEnabled: boolean,
): Array<BuiltinTool | false | undefined> {
  const hasQuestionTool = host.agent.rpc?.requestQuestion !== undefined;
  const hasMemoryTool = host.agent.memory?.isEnabled() === true;
  const hasCron = host.agent.cron !== null && host.agent.cron !== undefined;
  return [
    shouldCreateBuiltin(host, 'EnterPlanMode') && new b.EnterPlanModeTool(host.agent),
    shouldCreateBuiltin(host, 'ExitPlanMode') && new b.ExitPlanModeTool(host.agent),
    shouldCreateBuiltin(host, 'NextPhase') && new b.NextPhaseTool(host.agent),
    shouldCreateBuiltin(host, 'RecordInterviewFinding') &&
      new b.RecordInterviewFindingTool(host.agent),
    goalToolsEnabled &&
      shouldCreateBuiltin(host, 'CreateGoal') &&
      new b.CreateGoalTool(host.agent),
    goalToolsEnabled && shouldCreateBuiltin(host, 'GetGoal') && new b.GetGoalTool(host.agent),
    goalToolsEnabled &&
      shouldCreateBuiltin(host, 'SetGoalBudget') &&
      new b.SetGoalBudgetTool(host.agent),
    goalToolsEnabled &&
      shouldCreateBuiltin(host, 'UpdateGoal') &&
      new b.UpdateGoalTool(host.agent),
    shouldCreateBuiltin(host, 'GetCurrentTime') && new b.GetCurrentTimeTool(),
    hasQuestionTool &&
      shouldCreateBuiltin(host, 'AskUserQuestion') &&
      new b.AskUserQuestionTool(host.agent),
    shouldCreateBuiltin(host, 'TodoList') && new b.TodoListTool(host.toolStore),
    shouldCreateBuiltin(host, 'TaskGraph') &&
      b.createTaskGraphTool(host.toolStore, host.agent),
    hasMemoryTool && shouldCreateBuiltin(host, 'Memory') && new b.MemoryTool(host.agent.memory),
    shouldCreateBuiltin(host, 'TaskList') && new b.TaskListTool(background),
    shouldCreateBuiltin(host, 'TaskOutput') && new b.TaskOutputTool(background),
    shouldCreateBuiltin(host, 'TaskStop') && new b.TaskStopTool(background),
    hasCron && shouldCreateBuiltin(host, 'CronCreate') && new b.CronCreateTool(host.agent.cron),
    hasCron && shouldCreateBuiltin(host, 'CronList') && new b.CronListTool(host.agent.cron),
    hasCron && shouldCreateBuiltin(host, 'CronDelete') && new b.CronDeleteTool(host.agent.cron),
    shouldCreateBuiltin(host, 'JobCreate') && new b.JobCreateTool(host.toolStore, host.agent),
    shouldCreateBuiltin(host, 'JobList') && new b.JobListTool(host.toolStore),
    shouldCreateBuiltin(host, 'JobInspect') && new b.JobInspectTool(host.toolStore),
    shouldCreateBuiltin(host, 'JobSteer') && new b.JobSteerTool(host.toolStore, host.agent),
    shouldCreateBuiltin(host, 'JobCancel') && new b.JobCancelTool(host.toolStore, host.agent),
    shouldCreateBuiltin(host, 'MergeJob') && new b.MergeJobTool(host.toolStore, host.agent),
    shouldCreateBuiltin(host, 'PushJob') && new b.PushJobTool(host.toolStore, host.agent),
    shouldCreateBuiltin(host, 'JobSchedule') && new b.JobScheduleTool(host.toolStore, host.agent),
    shouldCreateBuiltin(host, 'JobResume') && new b.JobResumeTool(host.toolStore, host.agent),
    shouldCreateBuiltin(host, 'JobInbox') && new b.JobInboxTool(host.toolStore),
  ];
}

function createSkillAndSubagentTools(
  host: BuiltinToolsHost,
  background: Agent['background'],
  allowBackground: boolean,
): Array<BuiltinTool | false | undefined> {
  // Profile gating (shouldCreateBuiltin) is independent of invocable presence.
  // Do not OR shouldCreateBuiltin into this — empty enabledTools makes it always
  // true and would re-expose Skill/SearchSkill with no registry / no invocables.
  // Deferred catalog load still works: registerBuiltinSkills + project skills
  // usually provide invocables at start; tools call ensureCatalogLoaded on use.
  const hasInvocableSkills =
    (host.agent.skills?.registry.listInvocableSkills().length ?? 0) > 0;
  return [
    shouldCreateBuiltin(host, 'SearchTools') && new b.SearchToolsTool(host.agent),
    host.agent.skills !== null &&
      shouldCreateBuiltin(host, 'SkillCreate') &&
      new b.SkillCreateTool(host.agent),
    hasInvocableSkills && shouldCreateBuiltin(host, 'Skill') && new b.SkillTool(host.agent),
    hasInvocableSkills &&
      shouldCreateBuiltin(host, 'SearchSkill') &&
      new b.SearchSkillTool(host.agent),
    host.agent.subagentHost &&
      shouldCreateBuiltin(host, 'Agent') &&
      new b.AgentTool(
        host.agent.subagentHost,
        background,
        {
          ...DEFAULT_AGENT_PROFILES['agent']?.subagents,
          ...Object.fromEntries(
            host.agent.pluginAgents.map((agent) => [agent.profileName, agent.profile]),
          ),
        },
        {
          allowBackground,
          log: host.agent.log,
          pluginAgents: host.agent.pluginAgents,
        },
      ),
    host.agent.subagentHost &&
      shouldCreateBuiltin(host, 'SearchExpert') &&
      new b.SearchExpertTool(),
  ];
}

function createGuiAndWebTools(
  host: BuiltinToolsHost,
  toolServices: Agent['toolServices'],
): Array<BuiltinTool | false | undefined> {
  return [
    toolServices?.browserUse &&
      shouldCreateBuiltin(host, 'BrowserStatus') &&
      new b.BrowserStatusTool(toolServices.browserUse),
    toolServices?.browserUse &&
      shouldCreateBuiltin(host, 'BrowserObserve') &&
      new b.BrowserObserveTool(toolServices.browserUse),
    toolServices?.browserUse &&
      shouldCreateBuiltin(host, 'BrowserScreenshot') &&
      new b.BrowserScreenshotTool(toolServices.browserUse),
    toolServices?.browserUse &&
      shouldCreateBuiltin(host, 'BrowserAct') &&
      new b.BrowserActTool(toolServices.browserUse),
    toolServices?.browserUse &&
      shouldCreateBuiltin(host, 'BrowserConsole') &&
      new b.BrowserConsoleTool(toolServices.browserUse),
    // Always register when profile allows: missing runtime returns a clear error, never a fake pass.
    shouldCreateBuiltin(host, 'VerifySurface') &&
      new b.VerifySurfaceTool(toolServices?.browserUse, {
        kaos: host.agent.kaos,
        cwd: host.agent.config.cwd,
        ...resolveVerifySurfaceMediaOptions(host.agent),
      }),
    toolServices?.computerUse &&
      shouldCreateBuiltin(host, 'ComputerCapture') &&
      new b.ComputerCaptureTool(toolServices.computerUse),
    toolServices?.computerUse &&
      shouldCreateBuiltin(host, 'ComputerAct') &&
      new b.ComputerActTool(toolServices.computerUse),
    toolServices?.computerUse &&
      shouldCreateBuiltin(host, 'ComputerStatus') &&
      new b.ComputerStatusTool(toolServices.computerUse),
    toolServices?.webSearcher &&
      shouldCreateBuiltin(host, 'WebSearch') &&
      new b.WebSearchTool(toolServices.webSearcher),
    toolServices?.webSearcher &&
      shouldCreateBuiltin(host, 'DeepResearch') &&
      new b.DeepResearchTool(toolServices.webSearcher),
    toolServices?.urlFetcher &&
      shouldCreateBuiltin(host, 'FetchURL') &&
      new b.FetchURLTool(toolServices.urlFetcher),
    toolServices?.context7 &&
      shouldCreateBuiltin(host, 'Context7Resolve') &&
      new b.Context7ResolveTool(toolServices.context7),
    toolServices?.context7 &&
      shouldCreateBuiltin(host, 'Context7Docs') &&
      new b.Context7DocsTool(toolServices.context7),
  ];
}

function createVideoUploader(agent: Agent, provider: ChatProvider): b.VideoUploader | undefined {
  const uploadVideo = provider.uploadVideo?.bind(provider);
  if (uploadVideo === undefined) return undefined;

  const modelAlias = agent.config.modelAlias!;
  const withAuth = agent.modelProvider?.resolveAuth?.(modelAlias, {
    log: agent.log,
  });
  if (withAuth === undefined) return (input) => uploadVideo(input);
  return (input) => withAuth((auth) => uploadVideo(input, { auth }));
}
