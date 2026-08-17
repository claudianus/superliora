/**
 * Greenfield delivery chain — skeleton → fill → delete-pass as parent-linked Jobs.
 * Keeps JobKind stable; phases live on JobRecord.deliveryPhase.
 *
 * Parent product AC / visual commands stay on fill only. Skeleton is a
 * mechanical scaffold gate so host-browser EINVAL cannot stall the chain.
 */

import type { ToolStore } from '../../store';
import { createJob, type JobKind, type JobRecord } from './job-ledger';

export interface GreenfieldChainInput {
  readonly title: string;
  readonly kind?: JobKind;
  readonly priority?: number;
  readonly prompt?: string;
  readonly ownershipPaths?: readonly string[];
  readonly contextPaths?: readonly string[];
  readonly successCriteria?: readonly string[];
  readonly mustNotTouch?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly testSeams?: readonly string[];
  readonly tddMode?: JobRecord['tddMode'];
  readonly blockedByJobIds?: readonly string[];
  readonly parentJobId?: string;
  readonly modelAlias?: string;
  readonly surfaceKind?: JobRecord['surfaceKind'];
  readonly repoRoot?: string;
  readonly sessionRepoPath?: string;
}

/** Tool-name exclusions for skeleton mechanical commands — not product AC wording. */
const VISUAL_TOOL_RE = /verifysurface|browserstatus|browserscreenshot|playwright/i;

const MECHANICAL_CMD_RE = /tsc|typecheck|vitest|eslint|oxlint|lint|build|pnpm test|npm test/i;

export const SKELETON_SUCCESS_CRITERIA = [
  'Scaffold folders, entrypoints, types, empty scenes, and data schemas land.',
  'Typecheck, lint, unit tests, and build pass on the empty scaffold.',
] as const;

export const DELETE_PASS_SUCCESS_CRITERIA = [
  'Remove placeholders, dead code, and banned ship-state strings.',
  'Do not rebuild the product from scratch; keep fill behavior intact.',
] as const;

export const SKELETON_DEFAULT_VERIFICATION = [
  'npx tsc --noEmit',
  'npx vitest run --reporter=dot',
] as const;

const PHASES = [
  {
    phase: 'skeleton' as const,
    titlePrefix: 'Skeleton:',
    promptExtra:
      'Skeleton only. Folders, entrypoints, types, empty scenes, schemas, mechanical tests. ' +
      'Do not use VerifySurface as a done-gate on empty scenes. Chrome/Playwright reinstall loops are forbidden.',
  },
  {
    phase: 'fill' as const,
    titlePrefix: 'Fill:',
    promptExtra:
      'Fill the skeleton to meet product success criteria. Smallest diff; no decorative layers. ' +
      'Visual / VerifySurface belongs here when surface_kind=web.',
  },
  {
    phase: 'delete_pass' as const,
    titlePrefix: 'Delete-pass:',
    promptExtra:
      'Delete unused wrappers, placeholders, and decorative layers. Do not rebuild the product from scratch; re-run verification.',
  },
] as const;

export function isVisualOrProductGateLine(line: string): boolean {
  return VISUAL_TOOL_RE.test(line);
}

export function mechanicalVerificationCommands(
  commands: readonly string[] | undefined,
): readonly string[] {
  const kept = (commands ?? []).filter((cmd) => MECHANICAL_CMD_RE.test(cmd) && !VISUAL_TOOL_RE.test(cmd));
  return kept.length > 0 ? kept : [...SKELETON_DEFAULT_VERIFICATION];
}

function contractForPhase(
  phase: (typeof PHASES)[number]['phase'],
  input: GreenfieldChainInput,
): {
  readonly successCriteria: readonly string[] | undefined;
  readonly verificationCommands: readonly string[] | undefined;
  readonly surfaceKind: JobRecord['surfaceKind'] | undefined;
} {
  if (phase === 'skeleton') {
    return {
      successCriteria: [...SKELETON_SUCCESS_CRITERIA],
      verificationCommands: mechanicalVerificationCommands(input.verificationCommands),
      surfaceKind: undefined,
    };
  }
  if (phase === 'fill') {
    return {
      successCriteria: input.successCriteria,
      verificationCommands: input.verificationCommands,
      surfaceKind: input.surfaceKind,
    };
  }
  return {
    successCriteria: [...DELETE_PASS_SUCCESS_CRITERIA],
    verificationCommands: mechanicalVerificationCommands(input.verificationCommands),
    surfaceKind: undefined,
  };
}

/**
 * Enqueue three chained implement/task Jobs. Priority descends so skeleton
 * schedules first when the pool is free; parent links carry findings forward.
 */
export function createGreenfieldChainJobs(
  store: ToolStore,
  input: GreenfieldChainInput,
): readonly JobRecord[] {
  const baseKind: JobKind =
    input.kind === 'implement' || input.kind === 'task' || input.kind === undefined
      ? (input.kind ?? 'implement')
      : 'implement';
  const basePriority = input.priority ?? 0;
  const basePrompt = input.prompt?.trim();
  const created: JobRecord[] = [];
  let parentId = input.parentJobId;

  for (let i = 0; i < PHASES.length; i++) {
    const step = PHASES[i]!;
    const contract = contractForPhase(step.phase, input);
    const promptParts = [step.promptExtra, basePrompt].filter(Boolean);
    const job = createJob(store, {
      title: `${step.titlePrefix} ${input.title}`.slice(0, 120),
      kind: baseKind,
      priority: basePriority + (PHASES.length - i),
      prompt: promptParts.join('\n\n'),
      ownershipPaths: input.ownershipPaths,
      contextPaths: input.contextPaths,
      successCriteria: contract.successCriteria,
      mustNotTouch: input.mustNotTouch,
      verificationCommands: contract.verificationCommands,
      testSeams: input.testSeams,
      tddMode: input.tddMode,
      // Only the first phase waits on external blockers; later phases chain via parent.
      blockedByJobIds: i === 0 ? input.blockedByJobIds : undefined,
      deliveryMode: 'greenfield',
      deliveryPhase: step.phase,
      parentJobId: parentId,
      modelAlias: input.modelAlias,
      surfaceKind: contract.surfaceKind,
      repoRoot: input.repoRoot,
      sessionRepoPath: input.sessionRepoPath,
    });
    created.push(job);
    parentId = job.id;
  }

  return created;
}
