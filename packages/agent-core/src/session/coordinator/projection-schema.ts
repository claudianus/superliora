import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { workerAncestrySchema } from '@superliora/protocol';

const absolutePath = z.string().refine(isAbsolute, 'Expected absolute path');
export const coordinatorProjectionSchema = z.object({
  version: z.literal(1),
  records: z.array(z.object({
    id: z.string().startsWith('coord_'),
    idempotencyKey: z.string().min(1),
    kind: z.enum(['session', 'pipeline']).optional(),
    workerAncestry: workerAncestrySchema.optional(),
    originAncestry: workerAncestrySchema.optional(),
    pipeline: z.object({ planId: z.string(), binding: z.object({ version: z.literal(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).optional(), status: z.enum(['accepted', 'running', 'success', 'failed', 'blocked', 'cancelled', 'interrupted']), result: z.custom<import('../execution/pipeline').PipelineResult>().optional() }).optional(),
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
    verification: z.object({ planId: z.string(), revision: z.number().int(), status: z.enum(['accepted', 'running', 'passed', 'failed', 'stale', 'source_changed', 'interrupted', 'cancelled']), cancelRequested: z.boolean().optional(), receipt: z.custom<import('../execution/verification').VerificationReceipt>().optional(), error: z.string().optional() }).optional(),
    resumePrompt: z.string().optional(),
    result: z.string().optional(),
    error: z.string().optional(),
  })),
}).superRefine((projection, context) => {
  for (const field of ['id', 'idempotencyKey'] as const) {
    const values = projection.records.map((record) => record[field]);
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: `Duplicate ${field}` });
  }
});
