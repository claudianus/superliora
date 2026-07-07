import type { Agent } from '../..';
import type { ToolFileAccess } from '../../../loop/tool-access';
import { isUltraworkWorkflowReportWritePath } from '../../../ultrawork/workflow-report';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';

/**
 * Tools that are inherently read-only — they never mutate files, runstate,
 * or scheduled work.  In Ultra Plan read-only phases (research, interview,
 * design, review) these are always allowed without per-phase enumeration.
 *
 * When a new read-only tool is added to the codebase, add its name here and
 * it is automatically permitted in every read-only phase.  This replaces the
 * old per-phase hardcoded arrays that drifted out of sync (e.g. `ReadMediaFile`
 * and `LioraContext` were allowed in research/review but not in design).
 */
const READ_ONLY_TOOL_NAMES = new Set<string>([
  'Read',
  'ReadMediaFile',
  'Grep',
  'Glob',
  'LioraContext',
  'LioraRead',
  'LioraSearch',
  'LioraTree',
  'LioraSymbol',
  'LioraCallgraph',
  'LioraExpand',
  'LioraIndex',
  'WebSearch',
  'FetchURL',
  'Context7Resolve',
  'Context7Docs',
  'SearchSkill',
  'Skill',
  'SearchExpert',
  'TodoList',
  'TaskList',
  'TaskOutput',
]);

function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOL_NAMES.has(toolName);
}

export class PlanModeGuardDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'plan-mode-guard-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (!this.agent.planMode.isActive) return;

    const toolName = context.toolCall.name;
    const { isUltraMode, phase } = this.agent.planMode;

    if (
      (toolName === 'Write' || toolName === 'Edit') &&
      writesOnlyUltraworkWorkflowReport(context, this.agent)
    ) {
      return;
    }

    // Ultra Plan Mode: phase-aware tool restrictions
    if (isUltraMode) {
      const phaseResult = this.evaluateUltraPhase(context, phase);
      if (phaseResult !== undefined) return phaseResult;
    }

    // Normal plan mode guards (and ultra write-phase plan-file guard)
    if (toolName === 'Write' || toolName === 'Edit') {
      const planFilePath = this.agent.planMode.planFilePath;
      if (planFilePath === null) {
        return {
          kind: 'deny',
          message: planModeWriteDeniedMessage(planFilePath),
        };
      }
      if (writesOnlyPlanFile(context, planFilePath)) {
        return;
      }
      return {
        kind: 'deny',
        message: planModeWriteDeniedMessage(planFilePath),
      };
    }

    if (toolName === 'TaskStop') {
      return {
        kind: 'deny',
        message:
          'TaskStop is not available in plan mode. Call ExitPlanMode to exit plan mode before stopping a background task.',
      };
    }

    if (toolName === 'CronCreate' || toolName === 'CronDelete') {
      return {
        kind: 'deny',
        message:
          `${toolName} is not available in plan mode because it would mutate scheduled work that runs after plan exit. Call ExitPlanMode first.`,
      };
    }

    return;
  }

  private evaluateUltraPhase(
    context: PermissionPolicyContext,
    phase: string,
  ): PermissionPolicyResult | undefined {
    const toolName = context.toolCall.name;
    switch (phase) {
      case 'research': {
        // Read-only tools are always allowed in research phase.
        if (isReadOnlyTool(toolName) || toolName === 'NextPhase') return;
        if (toolName === 'Bash') {
          if (isNarrowReadOnlyBash(context)) return;
          return {
            kind: 'deny',
            message:
              'Bash is blocked in Research phase unless it is a simple read-only workspace inspection command (pwd, ls, tool lookup with which/command -v, git status, git diff --stat/name-only/check) or a chain of those commands joined with &&. Use WebSearch, FetchURL, LioraContext, Read, Grep, Glob, SearchExpert, TodoList, or NextPhase.',
          };
        }
        if (toolName === 'AskUserQuestion') {
          return {
            kind: 'deny',
            message:
              'AskUserQuestion is blocked in Research phase. Gather current evidence first, then call NextPhase({ phase: "interview" }) before asking the user.',
          };
        }
        if (toolName === 'ExitPlanMode') {
          return {
            kind: 'deny',
            message: 'ExitPlanMode is blocked in Research phase. Build a source-backed evidence pack, then use NextPhase to advance to Interview.',
          };
        }
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Research phase. Only read-only research tools, TodoList, and NextPhase are allowed before UltraPlan interview.`,
        };
      }
      case 'interview': {
        if (toolName === 'AskUserQuestion') {
          this.agent.planMode.incrementInterviewRound();
          return;
        }
        if (toolName === 'NextPhase') return;
        if (isReadOnlyTool(toolName)) return;
        if (toolName === 'Bash') {
          if (isNarrowReadOnlyBash(context) || isReadOnlyReviewBash(context)) return;
          return {
            kind: 'deny',
            message:
              'Bash is blocked in Interview phase unless it is a read-only inspection command (pwd, ls, cat, sed -n, head/tail, wc, file/stat, find without actions, grep/rg, jq, or read-only git). Use WebSearch, FetchURL, Read, Grep, Glob, LioraContext, SearchSkill, Skill, SearchExpert, TodoList, AskUserQuestion, or NextPhase.',
          };
        }
        if (toolName === 'EnterPlanMode') {
          return {
            kind: 'deny',
            message:
              'EnterPlanMode is already active in Ultra Plan interview. Use NextPhase to advance to Design; do not call EnterPlanMode with a phase argument.',
          };
        }
        if (toolName === 'ExitPlanMode') {
          return {
            kind: 'deny',
            message: 'ExitPlanMode is blocked in Interview phase. Use AskUserQuestion until the UltraGoal is true/false verifiable, then call NextPhase.',
          };
        }
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Interview phase. Use read-only research tools to sharpen the next question, then AskUserQuestion or NextPhase. NextPhase will remain blocked until the UltraGoal is true/false verifiable and required Seed gaps are closed.`,
        };
      }
      case 'design': {
        // Read-only tools are always allowed in design phase.
        if (isReadOnlyTool(toolName) || toolName === 'NextPhase') return;
        if (toolName === 'Bash') {
          if (isReadOnlyReviewBash(context)) return;
          return {
            kind: 'deny',
            message:
              'Bash is blocked in Design phase unless it is a read-only inspection command (pwd, ls, cat, sed -n, head/tail, wc, file/stat, find without actions, grep/rg, jq, or read-only git). Use Read, Grep, Glob, WebSearch, FetchURL, SearchSkill, Skill, SearchExpert, TodoList, or NextPhase.',
          };
        }
        if (toolName === 'ExitPlanMode') {
          return {
            kind: 'deny',
            message: 'ExitPlanMode is blocked in Design phase. Use NextPhase to advance to Review or Write when your design is complete.',
          };
        }
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Design phase. Only read-only tools, read-only Bash inspection, and TodoList progress tracking are allowed. Use NextPhase to advance when ready.`,
        };
      }
      case 'review': {
        // Read-only tools are always allowed in review phase.
        if (isReadOnlyTool(toolName) || toolName === 'NextPhase') return;
        if (toolName === 'Bash') {
          if (isReadOnlyReviewBash(context)) return;
          return {
            kind: 'deny',
            message:
              'Bash is blocked in Review phase unless it is a read-only inspection command (pwd, ls, cat, sed -n, head/tail, wc, file/stat, find without actions, grep/rg, jq, or read-only git). Use Read, Grep, Glob, LioraContext, WebSearch, FetchURL, SearchSkill, Skill, SearchExpert, TodoList, or NextPhase when ready.',
          };
        }
        if (toolName === 'ExitPlanMode') {
          return {
            kind: 'deny',
            message: 'ExitPlanMode is blocked in Review phase. Use NextPhase to advance to Write when verification is complete.',
          };
        }
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Review phase. Only read-only review tools, read-only Bash inspection, TodoList progress tracking, and NextPhase are allowed. Use NextPhase to advance when ready.`,
        };
      }
      case 'write': {
        const planFilePath = this.agent.planMode.planFilePath;
        if (toolName === 'Write' || toolName === 'Edit') return;
        if (toolName === 'Read' && planFilePath !== null && readsOnlyPlanFile(context, planFilePath)) return;
        if (toolName === 'TodoList') return;
        if (toolName === 'NextPhase' || toolName === 'ExitPlanMode') return;
        if (toolName === 'SearchSkill' || toolName === 'Skill') return;

        if (toolName === 'Bash') {
          return {
            kind: 'deny',
            message: 'Bash is blocked in Write phase. Focus on writing the plan file. Use NextPhase to advance to Exit when the plan is complete.',
          };
        }
        if (toolName === 'TaskStop' || toolName === 'CronCreate' || toolName === 'CronDelete') {
          return {
            kind: 'deny',
            message: `${toolName} is blocked in Write phase. Focus on writing the plan file.`,
          };
        }
        return {
          kind: 'deny',
          message:
            `${toolName} is blocked in Write phase. Only the current plan file may be read or edited, TodoList may be updated for progress tracking, SearchSkill/Skill may be used for the no-AI-slop prose gate, and NextPhase/ExitPlanMode may be used when the plan is complete.`,
        };
      }
      case 'exit': {
        // ExitPlanMode may report a missing required section. Allow plan-file
        // reads and edits so the agent can repair the plan instead of getting trapped.
        const planFilePath = this.agent.planMode.planFilePath;
        if (toolName === 'Read' && planFilePath !== null && readsOnlyPlanFile(context, planFilePath)) return;
        if (toolName === 'Write' || toolName === 'Edit') return;
        if (toolName === 'ExitPlanMode') return;
        if (toolName === 'SearchSkill' || toolName === 'Skill') return;
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Exit phase. Only ExitPlanMode, current plan-file reads or edits, and SearchSkill/Skill for the no-AI-slop prose gate are allowed.`,
        };
      }
      default:
        return;
    }
  }
}

function writesOnlyUltraworkWorkflowReport(
  context: PermissionPolicyContext,
  agent: Agent,
): boolean {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return false;

  const activation = ultrawork.getActivation();
  if (activation === undefined || ultrawork.getRun() === null) return false;

  const writeAccesses = writeFileAccesses(context);
  if (writeAccesses.length === 0) return false;

  const workDir =
    activation.workDir.length > 0 ? activation.workDir : agent.config.cwd;
  return writeAccesses.every((access) =>
    isUltraworkWorkflowReportWritePath(access.path, activation.evidenceRoot, workDir),
  );
}

function writesOnlyPlanFile(
  context: PermissionPolicyContext,
  planFilePath: string,
): boolean {
  const writeAccesses = writeFileAccesses(context);
  if (writeAccesses.length === 0) return false;
  return writeAccesses.every((access) => access.path === planFilePath);
}

function readsOnlyPlanFile(
  context: PermissionPolicyContext,
  planFilePath: string,
): boolean {
  const readAccesses =
    context.execution.accesses?.filter(
      (access): access is ToolFileAccess =>
        access.kind === 'file' && access.operation === 'read',
    ) ?? [];
  if (readAccesses.length === 0) return false;
  return readAccesses.every((access) => access.path === planFilePath);
}

function planModeWriteDeniedMessage(planFilePath: string | null): string {
  return `Plan mode is active. You may only write to the current plan file: ${
    planFilePath ?? '(no plan file selected yet)'
  }. Call ExitPlanMode to exit plan mode before editing other files.`;
}

function isNarrowReadOnlyBash(context: PermissionPolicyContext): boolean {
  const command = bashCommand(context)?.trim();
  if (command === undefined || command.length === 0) return false;
  if (isBackgroundBash(context)) return false;

  const commands = splitReadOnlyAndList(command);
  if (commands === undefined) return false;
  return commands.every(isNarrowReadOnlyResearchCommand);
}

function splitReadOnlyAndList(command: string): string[] | undefined {
  if (/[\n\r;|<>`]/.test(command) || command.includes('$(')) return undefined;
  if (command.replaceAll('&&', '').includes('&')) return undefined;

  const commands = command.split('&&').map((part) => part.trim());
  if (commands.length === 0 || commands.some((part) => part.length === 0)) return undefined;
  return commands;
}

function isNarrowReadOnlyResearchCommand(command: string): boolean {
  const words = shellWords(command);
  if (words === undefined || words.length === 0) return false;
  if (hasSensitivePath(words)) return false;

  return classifyResearchBashCommand(words) !== undefined;
}

type ResearchBashProfile =
  | 'workspace-inspection'
  | 'tool-lookup'
  | 'git-inspection';

function classifyResearchBashCommand(
  words: readonly string[],
): ResearchBashProfile | undefined {
  if (isWorkspaceInspectionCommand(words)) return 'workspace-inspection';
  if (isToolLookupCommand(words)) return 'tool-lookup';
  if (isResearchGitInspectionCommand(words)) return 'git-inspection';
  return undefined;
}

function isWorkspaceInspectionCommand(words: readonly string[]): boolean {
  const command = words[0];
  if (command === 'pwd') {
    return (
      words.length === 1 ||
      words.every((word, index) => index === 0 || word === '-L' || word === '-P')
    );
  }

  if (command === 'ls') {
    return words.slice(1).every(isLsInspectionArg);
  }

  return false;
}

function isLsInspectionArg(word: string): boolean {
  if (word.startsWith('-')) return /^-{1,2}[A-Za-z0-9,._=:-]+$/.test(word);
  return true;
}

function isToolLookupCommand(words: readonly string[]): boolean {
  if (words.length < 2) return false;
  if (words[0] === 'which') {
    return words.slice(1).every((word) => word === '-a' || word === '--all' || isExecutableName(word));
  }

  if (words[0] === 'command') {
    return words[1] === '-v' && words.length >= 3 && words.slice(2).every(isExecutableName);
  }

  return false;
}

function isResearchGitInspectionCommand(words: readonly string[]): boolean {
  const subcommandIndex = gitSubcommandIndex(words);
  if (subcommandIndex === undefined) return false;
  const subcommand = words[subcommandIndex];
  if (subcommand === undefined) return false;

  const args = words.slice(subcommandIndex + 1);
  switch (subcommand) {
    case 'status':
      return args.every(isResearchGitStatusArg);
    case 'diff':
      return args.every(isResearchGitDiffArg);
    case 'branch':
      return args.length === 1 && args[0] === '--show-current';
    case 'rev-parse':
      return args.length === 1 && (args[0] === '--show-toplevel' || args[0] === '--show-prefix');
    default:
      return false;
  }
}

function isResearchGitStatusArg(word: string): boolean {
  return (
    word === '--short' ||
    word === '--porcelain' ||
    word === '--branch' ||
    word === '-s' ||
    word === '-sb' ||
    word === '-uno' ||
    /^--untracked-files(?:=\S+)?$/.test(word)
  );
}

function isResearchGitDiffArg(word: string): boolean {
  return word === '--stat' || word === '--name-only' || word === '--check';
}

function isExecutableName(word: string): boolean {
  return !word.startsWith('-') && /^[A-Za-z0-9._+:-]+$/.test(word);
}

function isReadOnlyReviewBash(context: PermissionPolicyContext): boolean {
  const command = bashCommand(context)?.trim();
  if (command === undefined || command.length === 0) return false;
  if (isBackgroundBash(context)) return false;
  if (hasShellControlSyntax(command)) return false;

  const words = shellWords(command);
  if (words === undefined || words.length === 0) return false;
  if (hasSensitivePath(words)) return false;

  return isReadOnlyReviewCommand(words);
}

function bashCommand(context: PermissionPolicyContext): string | undefined {
  const args = context.args;
  if (args === null || typeof args !== 'object') return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

function isBackgroundBash(context: PermissionPolicyContext): boolean {
  const args = context.args;
  return (
    args !== null &&
    typeof args === 'object' &&
    (args as { run_in_background?: unknown }).run_in_background === true
  );
}

function hasShellControlSyntax(command: string): boolean {
  return /[\n\r;&|<>`]/.test(command) || command.includes('$(');
}

function shellWords(command: string): string[] | undefined {
  const words: string[] = [];
  let word = '';
  let hasWord = false;
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      word += char;
      hasWord = true;
      escaped = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaped = true;
      hasWord = true;
      continue;
    }

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        word += char;
      }
      hasWord = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasWord = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasWord) {
        words.push(word);
        word = '';
        hasWord = false;
      }
      continue;
    }

    word += char;
    hasWord = true;
  }

  if (escaped || quote !== undefined) return undefined;
  if (hasWord) words.push(word);
  return words;
}

function hasSensitivePath(words: readonly string[]): boolean {
  return words.some(
    (word) =>
      /(^|\/)\.env(?:[./-]|$)/i.test(word) ||
      /(^|\/)\.ssh(?:\/|$)/i.test(word) ||
      /(^|\/)\.aws\/credentials$/i.test(word) ||
      /(^|\/)\.gnupg(?:\/|$)/i.test(word) ||
      /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i.test(word) ||
      /\.(?:pem|p12|pfx)$/i.test(word),
  );
}

function isReadOnlyReviewCommand(words: readonly string[]): boolean {
  const command = words[0];
  if (command === undefined) return false;

  switch (command) {
    case 'pwd':
      return (
        words.length === 1 ||
        words.every((word, index) => index === 0 || word === '-L' || word === '-P')
      );
    case 'ls':
    case 'cat':
    case 'head':
    case 'tail':
    case 'wc':
    case 'file':
    case 'stat':
    case 'du':
    case 'nl':
    case 'rg':
    case 'grep':
    case 'jq':
      return true;
    case 'tree':
      return !hasTreeWriteOption(words);
    case 'which':
      return true;
    case 'command':
      return words[1] === '-v' && words.length >= 3;
    case 'find':
      return isReadOnlyFind(words);
    case 'sed':
      return isReadOnlySed(words);
    case 'git':
      return isReadOnlyGit(words);
    default:
      return false;
  }
}

function hasTreeWriteOption(words: readonly string[]): boolean {
  return words.some(
    (word, index) => index > 0 && (word.startsWith('-o') || word.startsWith('--output')),
  );
}

function isReadOnlyFind(words: readonly string[]): boolean {
  const dangerousActions = new Set([
    '-delete',
    '-exec',
    '-execdir',
    '-ok',
    '-okdir',
    '-fls',
    '-fprint',
    '-fprint0',
    '-fprintf',
  ]);
  return words.slice(1).every((word) => !dangerousActions.has(word));
}

function isReadOnlySed(words: readonly string[]): boolean {
  const scripts: string[] = [];
  let hasExplicitScript = false;
  let index = 1;
  for (; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === '-i' || word.startsWith('-i') || word === '--in-place' || word.startsWith('--in-place=')) {
      return false;
    }
    if (word === '-n' || word === '--quiet' || word === '--silent' || word === '-E' || word === '-r') {
      continue;
    }
    if (word === '-e') {
      const script = words[index + 1];
      if (script === undefined) return false;
      scripts.push(script);
      hasExplicitScript = true;
      index += 1;
      continue;
    }
    if (word.startsWith('-')) return false;
    if (hasExplicitScript) break;
    scripts.push(word);
    index += 1;
    break;
  }

  if (scripts.length === 0) return false;
  if (!scripts.every(isSedPrintScript)) return false;
  return index < words.length;
}

function isSedPrintScript(script: string): boolean {
  return (
    /^(?:\d+|\$)(?:,(?:\d+|\$))?p$/.test(script) ||
    /^\/[^/]+\/(?:,\/[^/]+\/)?p$/.test(script)
  );
}

function isReadOnlyGit(words: readonly string[]): boolean {
  const subcommandIndex = gitSubcommandIndex(words);
  if (subcommandIndex === undefined) return false;
  const subcommand = words[subcommandIndex];
  if (subcommand === undefined) return false;

  const readOnlySubcommands = new Set([
    'status',
    'diff',
    'branch',
    'rev-parse',
    'log',
    'show',
    'ls-files',
    'grep',
    'blame',
    'describe',
    'merge-base',
    'cat-file',
  ]);
  if (!readOnlySubcommands.has(subcommand)) return false;

  return !words.some(
    (word, index) =>
      index > subcommandIndex &&
      (word === '--output' ||
        word.startsWith('--output=') ||
        word === '--ext-diff' ||
        word === '--textconv' ||
        word === '-O' ||
        word === '--open-files-in-pager'),
  );
}

function gitSubcommandIndex(words: readonly string[]): number | undefined {
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === '--no-pager') continue;
    if (word === '-C') {
      index += 1;
      if (index >= words.length) return undefined;
      continue;
    }
    return index;
  }
  return undefined;
}
