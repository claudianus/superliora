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
