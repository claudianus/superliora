/**
 * Greenfield delivery chain — skeleton → fill → delete-pass as parent-linked Jobs.
 * Keeps JobKind stable; phases live on JobRecord.deliveryPhase.
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
}

const PHASES = [
  {
    phase: 'skeleton' as const,
    titlePrefix: 'Skeleton:',
    promptExtra:
      'Skeleton only: folders, entrypoints, types, empty surfaces. No product logic or decorative UI.',
  },
  {
    phase: 'fill' as const,
    titlePrefix: 'Fill:',
    promptExtra: 'Fill the skeleton to meet success criteria. Smallest diff; no decorative layers.',
  },
  {
    phase: 'delete_pass' as const,
    titlePrefix: 'Delete-pass:',
    promptExtra:
      'Delete unused wrappers and decorative layers without breaking success criteria; re-run verification.',
  },
];

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
    const promptParts = [step.promptExtra, basePrompt].filter(Boolean);
    const job = createJob(store, {
      title: `${step.titlePrefix} ${input.title}`.slice(0, 120),
      kind: baseKind,
      priority: basePriority + (PHASES.length - i),
      prompt: promptParts.join('\n\n'),
      ownershipPaths: input.ownershipPaths,
      contextPaths: input.contextPaths,
      successCriteria: input.successCriteria,
      mustNotTouch: input.mustNotTouch,
      verificationCommands: input.verificationCommands,
      testSeams: input.testSeams,
      tddMode: input.tddMode,
      // Only the first phase waits on external blockers; later phases chain via parent.
      blockedByJobIds: i === 0 ? input.blockedByJobIds : undefined,
      deliveryMode: 'greenfield',
      deliveryPhase: step.phase,
      parentJobId: parentId,
      modelAlias: input.modelAlias,
      surfaceKind: input.surfaceKind,
    });
    created.push(job);
    parentId = job.id;
  }

  return created;
}
