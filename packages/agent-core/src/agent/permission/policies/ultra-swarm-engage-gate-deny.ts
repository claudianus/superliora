import type { Agent } from '../..';
import { isUltraworkWorkflowReportWritePath } from '../../../ultrawork/workflow-report';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';
import { isReadOnlyTool } from './tool-read-only';

export class UltraSwarmEngageGateDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'ultra-swarm-engage-gate-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (this.agent.ultraSwarmEngageGate?.isActive !== true) return;
    const toolName = context.toolCall.name;
    // After an approved Ultra Plan with ENGAGE, the model must create/check the
    // UltraGoal then call UltraSwarm before product implementation. Transparency
    // ledgers under the active evidence root, wiki/memory, and read-only tools
    // stay allowed so stage narratives are not blocked by the engage gate.
    if (
      toolName === 'UltraSwarm' ||
      toolName === 'UltraworkGraph' ||
      toolName === 'EnterPlanMode' ||
      toolName === 'CreateGoal' ||
      toolName === 'GetGoal' ||
      toolName === 'TodoList' ||
      toolName === 'Memory' ||
      toolName === 'TaskList' ||
      toolName === 'TaskOutput'
    ) {
      return;
    }

    if (isReadOnlyTool(context)) {
      return;
    }

    // Bash is never classified read-only by name because it can run anything,
    // but pure inspection commands (git status, cat, sed -n, …) must stay
    // available for evidence packing while ENGAGE is binding. Allow only a
    // conservative allowlist with no chaining, redirection, or mutation flags.
    if (toolName === 'Bash' && isReadOnlyBashInspection(context)) {
      return;
    }

    if (
      (toolName === 'Write' || toolName === 'Edit') &&
      writesOnlyEngageTransparencyArtifacts(context, this.agent)
    ) {
      return;
    }

    return {
      kind: 'deny',
      message:
        'UltraSwarm ENGAGE is binding. Create the verifiable UltraGoal with CreateGoal (or check it with GetGoal), update UltraworkGraph if needed, then call UltraSwarm as the next execution tool. Transparency writes under the active evidence/wiki roots, Memory, TodoList, and read-only tools are allowed. To revise the Swarm decision to DEFER with a waiver, enter plan mode.',
      reason: {
        required_tool: 'UltraSwarm',
        attempted_tool: toolName,
      },
    };
  }
}

const READ_ONLY_SHELL_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'ls',
  'pwd',
  'wc',
  'stat',
  'file',
  'tree',
  'du',
  'df',
  'which',
  'where',
  'whereis',
  'date',
  'uname',
  'whoami',
  'hostname',
  'env',
  'printenv',
  'ps',
  'grep',
  'rg',
  'sort',
  'uniq',
  'cut',
  'tr',
  'diff',
  'echo',
  'printf',
  'true',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'id',
  'uptime',
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'describe',
  'blame',
  'shortlog',
  'grep',
  'reflog',
]);

function isReadOnlyBashInspection(context: PermissionPolicyContext): boolean {
  const args = context.args as { readonly command?: unknown } | undefined;
  const command = typeof args?.command === 'string' ? args.command.trim() : '';
  if (command.length === 0) return false;
  // Reject chaining, command substitution, backgrounding, and redirection.
  // A single pipe chain is re-allowed below when every segment is read-only.
  if (/[;`$<>&\n\r]/.test(command)) return false;
  const segments = command.split('|').map((segment) => segment.trim());
  if (segments.some((segment) => segment.length === 0)) return false;
  return segments.every((segment) => isReadOnlyShellSegment(segment.split(/\s+/)));
}

function isReadOnlyShellSegment(tokens: readonly string[]): boolean {
  const head = tokens[0];
  if (head === undefined) return false;
  if (head === 'git') return isReadOnlyGitSegment(tokens);
  if (head === 'sed') {
    return !tokens.some(
      (token) =>
        token === '-i' ||
        token.startsWith('--in-place') ||
        /^-[a-zA-Z]*i[a-zA-Z]*$/.test(token),
    );
  }
  return READ_ONLY_SHELL_COMMANDS.has(head);
}

function isReadOnlyGitSegment(tokens: readonly string[]): boolean {
  const sub = tokens[1];
  if (sub === undefined) return true;
  if (READ_ONLY_GIT_SUBCOMMANDS.has(sub)) return true;
  const rest = tokens.slice(2);
  switch (sub) {
    case 'branch':
      return !rest.some((token) => /^-[dDmM]/.test(token));
    case 'remote':
      return (
        rest.every((token) => token === '-v' || token === '--verbose') ||
        rest[0] === 'show' ||
        rest[0] === 'get-url'
      );
    case 'tag':
      return (
        rest.length === 0 ||
        rest[0] === '--list' ||
        rest[0] === '--points-at' ||
        /^-[ln]/.test(rest[0] ?? '')
      );
    case 'stash':
      return rest[0] === 'list' || rest[0] === 'show';
    case 'worktree':
      return rest[0] === 'list';
    default:
      return false;
  }
}

function writesOnlyEngageTransparencyArtifacts(
  context: PermissionPolicyContext,
  agent: Agent,
): boolean {
  const writeAccesses = writeFileAccesses(context);
  if (writeAccesses.length === 0) return false;

  const activation = agent.ultrawork.getActivation();
  const workDir =
    activation !== undefined && activation.workDir.length > 0
      ? activation.workDir
      : agent.config.cwd;
  const evidenceRoot = activation?.evidenceRoot;

  return writeAccesses.every((access) => {
    if (
      evidenceRoot !== undefined &&
      isUltraworkWorkflowReportWritePath(access.path, evidenceRoot, workDir)
    ) {
      return true;
    }
    return isEngageTransparencyPath(access.path, workDir, evidenceRoot);
  });
}

function isEngageTransparencyPath(
  path: string,
  workDir: string,
  evidenceRoot: string | undefined,
): boolean {
  const normalized = path.replaceAll('\\', '/');
  const relativeCandidates = [
    normalized,
    normalized.startsWith(`${workDir}/`) ? normalized.slice(workDir.length + 1) : normalized,
  ];
  for (const candidate of relativeCandidates) {
    if (candidate.includes('.superliora/wiki/')) return true;
    if (candidate.includes('.superliora/evidence/ultrawork-runs/')) return true;
    if (evidenceRoot !== undefined) {
      const root = evidenceRoot.replaceAll('\\', '/').replace(/\/+$/, '');
      if (candidate === root || candidate.startsWith(`${root}/`)) return true;
      if (normalized.includes(`/${root}/`) || normalized.endsWith(`/${root}`)) return true;
    }
  }
  return false;
}
