/**
 * Which tools the model always sees, and which are reachable through the
 * `ToolDevice` transport instead.
 *
 * The tool block is re-sent (and re-cached) on every request, and most of it is
 * prose and JSON schema for tools a given turn never touches: with the full
 * profile that block measures ~99 KB. Splitting it needs one honest signal —
 * "would the model reach for this reflexively?" — so the classification lives
 * here as a single table instead of being implied by profile YAML lists.
 *
 * Default is `core` for anything unlisted. Hiding a tool the model needs is far
 * worse than shipping a schema it does not, and MCP/custom tools are never
 * demoted: their names are not ours to guess.
 */

/** Tools every request keeps, plus the transport that reaches the rest. */
export const TOOL_DEVICE_TOOL_NAME = 'ToolDevice' as const;

export const CORE_TOOL_NAMES: Readonly<Record<string, true>> = {
  // The edit loop: reading, changing, and running the workspace.
  Read: true,
  Write: true,
  Edit: true,
  ApplyPatch: true,
  Bash: true,
  Glob: true,
  Grep: true,
  Script: true,
  // State the model keeps as it works.
  TodoList: true,
  TaskGraph: true,
  // Discovery: the transport itself, and the inventory it reads from.
  [TOOL_DEVICE_TOOL_NAME]: true,
  SearchTools: true,
  Skill: true,
  SearchSkill: true,
  // Interaction and the two tools models call without being told to.
  AskUserQuestion: true,
  WebSearch: true,
};

type ToolLoadMode = 'core' | 'discoverable';

/** Tools that stay in the request only when the tool-devices flag is off. */
const DISCOVERABLE_TOOL_NAMES: Readonly<Record<string, true>> = {
  // Fleet / job orchestration.
  Agent: true,
  JobCancel: true,
  JobCreate: true,
  JobInbox: true,
  JobInspect: true,
  JobList: true,
  JobResume: true,
  JobSchedule: true,
  JobSteer: true,
  MergeJob: true,
  PushJob: true,
  NextPhase: true,
  SearchExpert: true,
  // Goals.
  CreateGoal: true,
  GetGoal: true,
  SetGoalBudget: true,
  UpdateGoal: true,
  Refine: true,
  // Browser / desktop surfaces.
  BrowserAct: true,
  BrowserConsole: true,
  BrowserObserve: true,
  BrowserScreenshot: true,
  BrowserStatus: true,
  ComputerAct: true,
  ComputerCapture: true,
  ComputerStatus: true,
  VerifySurface: true,
  // Media and docs.
  GenerateImage: true,
  GenerateVideo: true,
  ReadMediaFile: true,
  Context7Docs: true,
  Context7Resolve: true,
  FetchURL: true,
  DeepResearch: true,
  // Planning / review / repo sweeps.
  Compact: true,
  EnterPlanMode: true,
  RecordInterviewFinding: true,
  RepoQuery: true,
  Review: true,
  RunProjectChecks: true,
  SkillCreate: true,
  GetCurrentTime: true,
};

export function resolveToolLoadMode(name: string): ToolLoadMode {
  if (CORE_TOOL_NAMES[name] === true) return 'core';
  if (DISCOVERABLE_TOOL_NAMES[name] === true) return 'discoverable';
  // Unknown names (MCP servers, plugins, user tools): never hidden.
  return 'core';
}

/** True when this tool's schema is kept out of the request while devices are on. */
export function isDeviceMountable(name: string): boolean {
  return resolveToolLoadMode(name) === 'discoverable';
}