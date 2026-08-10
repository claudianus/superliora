/**
 * JobSteer — redirect a live Job and optionally patch surface_kind.
 */

import { z } from 'zod';

import type { Agent } from '../../../agent/index';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import { renderJobLine, type JobStatus } from './job-ledger';
import { steerJobWorker } from './job-worker';

const JobStatusSchema = z.enum([
  'queued',
  'running',
  'blocked',
  'needs_user',
  'done',
  'failed',
  'cancelled',
  'interrupted',
]);

const JobSteerInputSchema = z
  .object({
    job_id: z.string().trim().min(1),
    message: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Steering instruction for the worker / meta notes. State the delta precisely (what changed, what stays); quote the user when relevant.',
      ),
    status: JobStatusSchema.optional().describe('Optional status update while steering.'),
    surface_kind: z
      .enum(['none', 'web', 'tui', 'mixed'])
      .optional()
      .describe('Patch surface_kind when MergeJob holds for a missing contract.'),
  })
  .strict();

function ack(jobId: string, status: JobStatus, extra?: string): string {
  const line = `ACK ${jobId} state=${status}`;
  return extra ? `${line}\n${extra}` : line;
}

export class JobSteerTool implements BuiltinTool<z.infer<typeof JobSteerInputSchema>> {
  readonly name = 'JobSteer' as const;
  readonly description =
    'Redirect a live Job without restarting it: append notes and deliver to the running worker when possible. ' +
    'Use when the goal stands but details changed (scope delta, extra constraint, user preference). ' +
    'If the goal itself changed, JobCancel + fresh JobCreate instead — never let two versions of one goal race.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(JobSteerInputSchema);

  constructor(
    private readonly store: ToolStore,
    private readonly agent?: Agent,
  ) {}

  resolveExecution(args: z.infer<typeof JobSteerInputSchema>): ToolExecution {
    const parsed = JobSteerInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: `Invalid JobSteer args: ${parsed.error.message}` };
    }
    const a = parsed.data;
    return {
      accesses: ToolAccesses.all(),
      description: `Steer ${a.job_id}`,
      readOnly: false,
      approvalRule: this.name,
      execute: async () => {
        const result = steerJobWorker({
          store: this.store,
          agent: this.agent,
          jobId: a.job_id,
          message: a.message,
          status: a.status,
          surfaceKind: a.surface_kind,
        });
        if (!result.ok || !result.job) {
          return { isError: true, output: result.error ?? `Job not found: ${a.job_id}` };
        }
        return {
          isError: false,
          output: ack(
            result.job.id,
            result.job.status,
            `${renderJobLine(result.job)}\nsteered=${result.steered}`,
          ),
        };
      },
    };
  }
}
