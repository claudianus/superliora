import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { workerAncestrySchema } from '@superliora/protocol';

const absolutePath = z.string().refine(isAbsolute, 'Expected absolute path');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({
  version: z.literal(1),
  artifactHash: sha256,
  sourceRevision: z.string(),
  sourceTree: z.string(),
  requirementsHash: z.string(),
  status: z.enum(['passed', 'failed', 'stale', 'source_changed', 'cancelled']),
  stages: z.array(z.object({
    stageId: z.string(),
    command: z.array(z.string()),
    scope: z.string(),
    cwd: absolutePath,
    environment: z.object({ values: z.record(z.string(), z.string()), removedKeys: z.array(z.string()) }),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    timedOut: z.boolean(),
    cancelled: z.boolean(),
    outputTruncated: z.boolean(),
    startedAt: z.string(),
    finishedAt: z.string(),
    stdoutPath: absolutePath,
    stderrPath: absolutePath,
    stdoutHash: sha256,
    stderrHash: sha256,
    failure: z.string().optional(),
  })),
  evidencePath: absolutePath,
  failure: z.string().optional(),
}) satisfies z.ZodType<import('../execution/verification').VerificationReceipt>;
const pipelineStatus = z.enum(['success', 'failed', 'blocked', 'cancelled']);
const pipelineResultSchema = z.object({
  planId: z.string(),
  status: pipelineStatus,
  stages: z.array(z.object({
    stageId: z.string(),
    status: pipelineStatus,
    attempts: z.number().int().nonnegative(),
    receipts: z.array(receiptSchema),
    failure: z.string().optional(),
  })),
}) satisfies z.ZodType<import('../execution/pipeline').PipelineResult>;
export const coordinatorProjectionSchema = z.object({
  version: z.literal(1),
  records: z.array(z.object({
    id: z.string().startsWith('coord_'),
    idempotencyKey: z.string().min(1),
    kind: z.enum(['session', 'pipeline']).optional(),
    workerAncestry: workerAncestrySchema.optional(),
    originAncestry: workerAncestrySchema.optional(),
    pipeline: z.object({ planId: z.string(), binding: z.object({ version: z.literal(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).optional(), status: z.enum(['accepted', 'running', 'success', 'failed', 'blocked', 'cancelled', 'interrupted']), result: pipelineResultSchema.optional() }).optional(),
    request: z.object({
      prompt: z.string().min(1),
      description: z.string().min(1),
      cwd: absolutePath,
      model: z.string().optional(),
      purpose: z.string().optional(),
      sourceRevision: z.string().optional(),
      workerAncestry: workerAncestrySchema.optional(),
      ownership: z.array(absolutePath).optional(),
      timeoutMs: z.number().nonnegative().optional(),
    }),
    revision: z.number().int().positive(),
    status: z.enum(['accepted', 'admitting', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'cancel_requested', 'idle', 'yielded', 'finished']),
    sessionId: z.string().optional(),
    lease: z.object({ owner: z.string(), token: z.string(), expiresAt: z.number() }).optional(),
    mailbox: z.array(z.object({ id: z.string().min(1), text: z.string().min(1), status: z.enum(['pending', 'sending', 'delivered']) })),
    verification: z.object({ planId: z.string(), revision: z.number().int(), status: z.enum(['accepted', 'running', 'passed', 'failed', 'stale', 'source_changed', 'interrupted', 'cancelled']), cancelRequested: z.boolean().optional(), receipt: receiptSchema.optional(), error: z.string().optional() }).optional(),
    resumePrompt: z.string().optional(),
    resumeMessageId: z.string().optional(),
    result: z.string().optional(),
    error: z.string().optional(),
  })),
}).superRefine((projection, context) => {
  for (const field of ['id', 'idempotencyKey'] as const) {
    const values = projection.records.map((record) => record[field]);
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: `Duplicate ${field}` });
  }
});
