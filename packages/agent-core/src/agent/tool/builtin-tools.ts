import type { ChatProvider, ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import { ProviderManager } from '../../session/provider/provider-manager';
import { analyzeMediaPart } from '../../session/vision-analyzer';
import { extendWorkspaceWithSkillRoots } from '../../skill/scanner';
import * as b from '../../tools/builtin';
import { createVisualDiffTool } from '../../tools/visual-diff-tool';
import type { ToolStore } from '../../tools/store';
import { DEFAULT_AGENT_PROFILES } from '../../profile';
import { nonEmptyEnv } from './env';
import type { BuiltinTool } from './types';

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

export function buildBuiltinTools(host: BuiltinToolsHost): Map<string, BuiltinTool> {
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
  const goalToolsEnabled = host.agent.type === 'main';
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
      }),
    shouldCreateBuiltin(host, 'Edit') &&
      new b.EditTool(kaos, workspace, {
        fileSnapshots: host.agent.fileSnapshots,
        getTurnId: () =>
          host.agent.turn.currentId !== undefined ? String(host.agent.turn.currentId) : undefined,
        getSwarmLease: () => host.agent.swarmFileLease,
      }),
    shouldCreateBuiltin(host, 'Grep') && new b.GrepTool(kaos, workspace, host.agent.telemetry),
    shouldCreateBuiltin(host, 'Glob') && new b.GlobTool(kaos, workspace, host.agent.telemetry),
    shouldCreateBuiltin(host, 'LioraRead') && new b.LioraReadTool(kaos, workspace, host.toolStore),
    shouldCreateBuiltin(host, 'LioraTree') && new b.LioraTreeTool(kaos, workspace),
    shouldCreateBuiltin(host, 'LioraSymbol') && new b.LioraSymbolTool(kaos, workspace),
    shouldCreateBuiltin(host, 'LioraCallgraph') && new b.LioraCallgraphTool(kaos, workspace),
    shouldCreateBuiltin(host, 'LioraExpand') && new b.LioraExpandTool(host.toolStore),
    shouldCreateBuiltin(host, 'Bash') &&
      new b.BashTool(kaos, cwd, background, {
        allowBackground,
        store: host.toolStore,
      }),
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
      b.isGenerateImageAvailable(resolveMediaProviderEnv(host.agent)) &&
      new b.GenerateImageTool(kaos, workspace, resolveMediaProviderEnv(host.agent)),
    shouldCreateBuiltin(host, 'GenerateVideo') &&
      b.isGenerateVideoAvailable(resolveMediaProviderEnv(host.agent)) &&
      new b.GenerateVideoTool(kaos, workspace, resolveMediaProviderEnv(host.agent)),
    shouldCreateBuiltin(host, 'LioraReview') && b.createLioraReviewTool(kaos, host.agent),
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

function resolveMediaProviderEnv(agent: Agent): b.GenerateImageProviderEnv & b.GenerateVideoProviderEnv {
  const services = agent.toolServices;
  return {
    xaiGrokBuild: services?.xaiGrokBuild,
    xaiApiKey: nonEmptyEnv('XAI_API_KEY'),
    openaiApiKey: nonEmptyEnv('OPENAI_API_KEY'),
    googleApiKey: nonEmptyEnv('GOOGLE_API_KEY') ?? nonEmptyEnv('GEMINI_API_KEY'),
    qwenTokenPlanApiKey: nonEmptyEnv('QWEN_TOKEN_PLAN_API_KEY'),
  };
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
    goalToolsEnabled &&
      shouldCreateBuiltin(host, 'CreateUltraGoal') &&
      new b.CreateUltraGoalTool(host.agent),
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
    shouldCreateBuiltin(host, 'UltraworkGraph') &&
      new b.UltraworkGraphTool(host.toolStore, host.agent),
    hasMemoryTool && shouldCreateBuiltin(host, 'Memory') && new b.MemoryTool(host.agent.memory!),
    shouldCreateBuiltin(host, 'TaskList') && new b.TaskListTool(background),
    shouldCreateBuiltin(host, 'TaskOutput') && new b.TaskOutputTool(background),
    shouldCreateBuiltin(host, 'TaskStop') && new b.TaskStopTool(background),
    hasCron && shouldCreateBuiltin(host, 'CronCreate') && new b.CronCreateTool(host.agent.cron!),
    hasCron && shouldCreateBuiltin(host, 'CronList') && new b.CronListTool(host.agent.cron!),
    hasCron && shouldCreateBuiltin(host, 'CronDelete') && new b.CronDeleteTool(host.agent.cron!),
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
    hasInvocableSkills && shouldCreateBuiltin(host, 'Skill') && new b.SkillTool(host.agent),
    hasInvocableSkills &&
      shouldCreateBuiltin(host, 'SearchSkill') &&
      new b.SearchSkillTool(host.agent),
    host.agent.subagentHost &&
      shouldCreateBuiltin(host, 'Agent') &&
      new b.AgentTool(
        host.agent.subagentHost,
        background,
        DEFAULT_AGENT_PROFILES['agent']?.subagents,
        {
          allowBackground,
          log: host.agent.log,
        },
      ),
    host.agent.subagentHost &&
      shouldCreateBuiltin(host, 'SearchExpert') &&
      new b.SearchExpertTool(),
    host.agent.subagentHost &&
      shouldCreateBuiltin(host, 'AgentSwarm') &&
      new b.AgentSwarmTool(host.agent.subagentHost, host.agent.swarmMode, host.toolStore),
    host.agent.subagentHost &&
      shouldCreateBuiltin(host, 'UltraSwarm') &&
      new b.UltraSwarmTool(
        host.agent.subagentHost,
        host.agent.swarmMode,
        host.toolStore,
        host.agent,
      ),
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
