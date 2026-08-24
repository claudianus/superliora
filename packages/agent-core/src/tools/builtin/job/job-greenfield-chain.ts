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

/**
 * One greenfield session — skeleton → fill → delete-pass as TodoList phases
 * on a single Job, not three sibling workers.
 */
export function createGreenfieldChainJobs(
  store: ToolStore,
  input: GreenfieldChainInput,
): readonly JobRecord[] {
  const baseKind: JobKind =
    input.kind === 'implement' || input.kind === 'task' || input.kind === undefined
      ? (input.kind ?? 'implement')
      : 'implement';
  const basePrompt = input.prompt?.trim();
  const phasePlaybook = PHASES.map(
    (step) => `${step.titlePrefix.replace(/:$/, '')}: ${step.promptExtra}`,
  ).join('\n');
  const promptParts = [
    'Greenfield in ONE session. Work these phases in order (TodoList); do not spawn sibling Jobs.',
    phasePlaybook,
    basePrompt,
  ].filter(Boolean);
  const job = createJob(store, {
    title: input.title.slice(0, 120),
    kind: baseKind,
    priority: input.priority ?? 0,
    prompt: promptParts.join('\n\n'),
    ownershipPaths: input.ownershipPaths,
    contextPaths: input.contextPaths,
    successCriteria: input.successCriteria,
    mustNotTouch: input.mustNotTouch,
    verificationCommands: input.verificationCommands,
    testSeams: input.testSeams,
    tddMode: input.tddMode,
    blockedByJobIds: input.blockedByJobIds,
    deliveryMode: 'greenfield',
    parentJobId: input.parentJobId,
    modelAlias: input.modelAlias,
    surfaceKind: input.surfaceKind,
    repoRoot: input.repoRoot,
    sessionRepoPath: input.sessionRepoPath,
  });
  return [job];
}
