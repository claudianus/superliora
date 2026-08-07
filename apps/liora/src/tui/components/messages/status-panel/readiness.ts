import { renderRendererRatioProgressBar } from '#/tui/renderer';
import { CORE_WAIST_STATUS_HINT } from '#/tui/commands/config/harness/agent-profile';
import { safeUsageRatio } from '#/utils/usage/usage-format';

import { contextValues } from './context';
import type { StatusFieldRow } from './provider-route';
import {
  humanWritingBlocked,
  verifyBlockedByReadiness,
} from './runtime-rows';
import type { StatusGoalStatus, StatusReportOptions } from './types';

function formatGoalStatus(status: StatusGoalStatus | undefined): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'blocked':
      return 'blocked';
    case 'complete':
      return 'complete';
    case undefined:
      return 'ready';
  }
}

function formatVerifyStatus(status: StatusGoalStatus | undefined, planMode: boolean, blocked: boolean): string {
  if (status === 'complete') return 'passed';
  if (status === 'blocked' || blocked) return 'blocked';

  switch (status) {
    case 'active':
    case 'paused':
      return 'queued';
    case undefined:
      return planMode ? 'queued' : 'ready';
  }
}

function formatUltraworkStageStatus(options: StatusReportOptions): string {
  const planMode = options.status?.planMode ?? options.planMode;
  const blocked = verifyBlockedByReadiness(options);
  const plan = planMode ? 'Plan on' : 'Plan off';
  const goal = `Goal ${formatGoalStatus(options.goalStatus)}`;
  const verify = `Verify ${formatVerifyStatus(options.goalStatus, planMode, blocked)}`;

  return `${plan} | ${goal} | ${verify}`;
}

function formatUltraworkFlow(options: StatusReportOptions): StatusFieldRow {
  const planMode = options.status?.planMode ?? options.planMode;
  const blocked = verifyBlockedByReadiness(options);
  const verify = formatVerifyStatus(options.goalStatus, planMode, blocked);
  if (verify === 'passed') {
    return {
      label: 'Flow',
      value: `${renderRendererRatioProgressBar({ ratio: 1, width: 4 })} 4/4 verified`,
    };
  }
  if (verify === 'blocked') {
    return {
      label: 'Flow',
      value: `${renderRendererRatioProgressBar({ ratio: 0.75, width: 4 })} 3/4 verify blocked`,
      severity: 'error',
    };
  }
  if (verify === 'queued') {
    return {
      label: 'Flow',
      value: `${renderRendererRatioProgressBar({ ratio: 0.75, width: 4 })} 3/4 verify queued`,
    };
  }
  return {
    label: 'Flow',
    value: `${renderRendererRatioProgressBar({ ratio: 1, width: 4 })} 4/4 ready to run`,
  };
}

function formatReadinessBlockers(options: StatusReportOptions): string {
  const blockers: string[] = [];
  const model = (options.status?.model ?? options.model).trim();
  if (model.length === 0) blockers.push('model setup');
  const { ratio, maxTokens } = contextValues(options);
  if (maxTokens > 0 && safeUsageRatio(ratio) >= 0.70) blockers.push('context high');
  if (options.gitStatus?.dirty === true) blockers.push('worktree dirty');
  if (options.goalStatus === 'blocked') blockers.push('goal blocked');
  if (humanWritingBlocked(options)) blockers.push('writing guidance');
  return blockers.length === 0 ? 'none detected' : blockers.join(', ');
}

function formatRecoveryGate(options: StatusReportOptions): string {
  return options.recovery?.ready === true
    ? 'resumable evidence ready -> durable target'
    : 'resumable evidence needed -> durable target';
}

function compactCatalogValue(value: string): string {
  const maxLength = 28;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, 12)}...${value.slice(value.length - 13)}`;
}

function formatModelCatalogGate(options: StatusReportOptions): string {
  const modelCount = Object.keys(options.availableModels).length;
  const providerCount = Object.keys(options.availableProviders ?? {}).length;
  const model = (options.status?.model ?? options.model).trim();
  const activeProvider = model.length > 0 ? options.availableModels[model]?.provider : undefined;

  if (modelCount === 0 && providerCount === 0) return 'no catalog loaded';
  if (activeProvider === undefined) {
    return `${String(modelCount)} models / ${String(providerCount)} providers; choose model`;
  }
  return (
    `${String(modelCount)} models / ${String(providerCount)} providers; ` +
    `active ${compactCatalogValue(activeProvider)}`
  );
}

const QWEN_TOKEN_PLAN_PROVIDER_ID = 'qwen-token-plan';

function formatQwenTokenPlanGate(options: StatusReportOptions): string {
  const providers = options.availableProviders ?? {};
  // Any Token Plan identity counts: the canonical first-class id plus the
  // models.dev catalog ids (alibaba-token-plan / alibaba-token-plan-cn).
  const tokenPlanProvider =
    providers[QWEN_TOKEN_PLAN_PROVIDER_ID] ??
    providers['alibaba-token-plan'] ??
    providers['alibaba-token-plan-cn'];
  if (tokenPlanProvider === undefined) return 'not connected';
  const hasKey = tokenPlanProvider.apiKey !== undefined && tokenPlanProvider.apiKey.length > 0;
  if (!hasKey) return 'configured (no key)';
  return 'connected · text/image/video/harness';
}

const READINESS_CHECKS = 'inspect -> test -> change -> verify -> summarize';
const WORKFLOW_GATE = 'research → interview → goal → integrate → verify → learn';
const ENGINE_GATE = 'Plan | Goal | Research | Integrate | Verify | Learn';
const AUTONOMY_GATE = 'bounded now -> headless target';
const TOOLS_GATE = 'search first; load tools on demand';
const RESEARCH_GATE = 'WebSearch + FetchURL + Context7 ready (local fallback)';
const BENCH_GATE = 'Bench seed/holdout · web/media/office/ZDR · a1/m2/sw800/s8';
const MEDIA_GATE =
  'set OPENAI_API_KEY or GOOGLE/GEMINI_API_KEY for GenerateImage/GenerateVideo (no MCP)';
const OFFICE_GATE =
  'SearchSkill → docx / pptx / xlsx for Word, slides, and sheets (zero MCP)';
const SCOPE_GATE = 'small focused diff; no broad refactor';
const COVERAGE_GATE = 'test public behavior changes';
const WRITING_GATE = 'human voice lanes; detectors advisory-only';
const WRITING_BLOCKED_GATE = 'voice-lane guidance blocked; detectors must stay advisory-only';
const SCREEN_CHECK_GATE = 'open changed screen before finishing';
const DONE_GATE = 'tests + typecheck/lint/build + clean diff + TUI';

function formatToolsGate(options: StatusReportOptions): string {
  const names = options.activeToolNames;
  if (names === undefined) {
    return `${TOOLS_GATE} · ${CORE_WAIST_STATUS_HINT}`;
  }
  const count = names.length;
  const inventory = names.includes('SearchTools') ? ' · SearchTools on' : ' · SearchTools off';
  const skills = names.includes('SearchSkill') ? ' · SearchSkill on' : '';
  return `${String(count)} active tools${inventory}${skills} · /tools for full list · ${CORE_WAIST_STATUS_HINT}`;
}

function formatMemoryGate(options: StatusReportOptions): string {
  const dream = options.autoDream ?? options.status?.autoDream;
  let dreamPart = 'reflection on';
  if (dream !== undefined && dream !== null) {
    if (!dream.enabled) {
      dreamPart = 'reflection off';
    } else if (dream.inFlight) {
      dreamPart = 'reflection…';
    } else if (dream.runs > 0) {
      dreamPart = `reflection×${String(dream.runs)}`;
    } else {
      dreamPart = `reflection ≥${String(dream.minHours)}h/${String(dream.minActiveRecords)} candidate(s)`;
    }
  }
  return `prefs | session recall | ${dreamPart}`;
}

function hasActiveTool(options: StatusReportOptions, name: string): boolean | undefined {
  if (options.activeToolNames === undefined) return undefined;
  return options.activeToolNames.includes(name);
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function imageProviderKeyReady(): boolean {
  return (
    nonEmptyEnv(process.env['OPENAI_API_KEY']) !== undefined ||
    nonEmptyEnv(process.env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(process.env['GEMINI_API_KEY']) !== undefined
  );
}

function formatSearchKeyHint(): string {
  const envNames = [
    'BRAVE_API_KEY',
    'BRAVE_SEARCH_API_KEY',
    'TAVILY_API_KEY',
    'EXA_API_KEY',
    'SERPER_API_KEY',
    'SERPER_DEV_API_KEY',
  ] as const;
  const present = envNames.filter((name) => {
    const value = process.env[name];
    return value !== undefined && value.trim().length > 0;
  });
  if (present.length === 0) return ' · free local (set BRAVE/TAVILY/EXA/SERPER key for multi-provider)';
  const short = present
    .map((name) => name.replace(/_API_KEY$/u, '').replace(/_SEARCH$/u, '').toLowerCase())
    .join('+');
  return ` · paid:${short}`;
}

function formatResearchGate(options: StatusReportOptions): string {
  const web = hasActiveTool(options, 'WebSearch');
  const fetch = hasActiveTool(options, 'FetchURL');
  const c7Resolve = hasActiveTool(options, 'Context7Resolve');
  const c7Docs = hasActiveTool(options, 'Context7Docs');
  const searchKeys = formatSearchKeyHint();
  if (web === undefined || fetch === undefined) {
    return `${RESEARCH_GATE}${searchKeys}`;
  }
  const context7 =
    c7Resolve === true || c7Docs === true
      ? ' · Context7 on'
      : c7Resolve === false && c7Docs === false
        ? ' · Context7 off'
        : '';
  if (web && fetch) {
    return `ready · WebSearch + FetchURL active${context7}${searchKeys}`;
  }
  if (!web && !fetch) return 'unavailable · Web research tools missing in this session';
  return `partial · WebSearch ${web ? 'on' : 'off'} · FetchURL ${fetch ? 'on' : 'off'}${context7}${searchKeys}`;
}

function formatMediaGate(options: StatusReportOptions): string {
  const image = hasActiveTool(options, 'GenerateImage');
  const video = hasActiveTool(options, 'GenerateVideo');
  if (image === true && video === true) {
    return 'ready · GenerateImage + GenerateVideo active (keys detected)';
  }
  if (image === true) return 'ready · GenerateImage active (key detected)';
  if (video === true) return 'ready · GenerateVideo active (Google/Gemini key)';
  if (imageProviderKeyReady()) {
    return 'key ready · GenerateImage/GenerateVideo will register when profile allows';
  }
  return MEDIA_GATE;
}

function readinessGateRows(options: StatusReportOptions): readonly StatusFieldRow[] {
  const writingBlocked = humanWritingBlocked(options);
  const writingRow: StatusFieldRow = writingBlocked
    ? { label: 'Writing', value: WRITING_BLOCKED_GATE, severity: 'error' }
    : { label: 'Writing', value: WRITING_GATE };
  return [
    { label: 'Checks', value: READINESS_CHECKS },
    { label: 'Workflow', value: WORKFLOW_GATE },
    { label: 'Engine', value: ENGINE_GATE },
    { label: 'Autonomy', value: AUTONOMY_GATE },
    { label: 'Recovery', value: formatRecoveryGate(options) },
    { label: 'Tools', value: formatToolsGate(options) },
    { label: 'Research', value: formatResearchGate(options) },
    { label: 'Bench', value: BENCH_GATE },
    { label: 'Media', value: formatMediaGate(options) },
    { label: 'Office', value: OFFICE_GATE },
    { label: 'Catalog', value: formatModelCatalogGate(options) },
    { label: 'Token Plan', value: formatQwenTokenPlanGate(options) },
    { label: 'Memory', value: formatMemoryGate(options) },
    formatUltraworkFlow(options),
    { label: 'Stages', value: formatUltraworkStageStatus(options) },
    { label: 'Blockers', value: formatReadinessBlockers(options) },
    { label: 'Scope', value: SCOPE_GATE },
    { label: 'Coverage', value: COVERAGE_GATE },
    writingRow,
    { label: 'Screen check', value: SCREEN_CHECK_GATE },
    { label: 'Done gate', value: DONE_GATE },
  ];
}

export function readinessRows(options: StatusReportOptions): readonly StatusFieldRow[] {
  const gateRows = readinessGateRows(options);
  const model = (options.status?.model ?? options.model).trim();
  if (model.length === 0) {
    return [
      { label: 'State', value: 'Model needed', severity: 'error' },
      ...gateRows,
      { label: 'Next', value: 'Run /login to add a provider, then /model to pick one.' },
    ];
  }

  const { ratio, maxTokens } = contextValues(options);
  if (maxTokens > 0 && safeUsageRatio(ratio) >= 0.70) {
    return [
      { label: 'State', value: 'Context high' },
      ...gateRows,
      { label: 'Next', value: 'Run /compact before long work.' },
    ];
  }

  if (options.gitStatus?.dirty === true) {
    return [
      { label: 'State', value: 'Worktree dirty' },
      ...gateRows,
      { label: 'Next', value: 'Review changed files before finishing.' },
    ];
  }

  if (humanWritingBlocked(options)) {
    return [
      { label: 'State', value: 'Writing guidance blocked', severity: 'error' },
      ...gateRows,
      {
        label: 'Next',
        value: options.humanWriting?.nextAction ?? 'Restore writing-quality guidance before long autonomous work.',
      },
    ];
  }

  if (options.goalStatus === 'blocked') {
    return [
      { label: 'State', value: 'Goal blocked', severity: 'error' },
      ...gateRows,
      { label: 'Next', value: 'Resolve or replace the blocked goal before continuing.' },
    ];
  }

  return [
    { label: 'State', value: 'Ready' },
    ...gateRows,
    { label: 'Next', value: 'Type your task, or /plan to plan it first.' },
  ];
}
