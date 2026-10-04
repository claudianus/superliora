import { z } from 'zod';

export interface WorkerAncestry {
  readonly agentId: string;
  readonly sessionId: string;
  readonly parentAgentId: string | null;
  readonly parentSessionId: string | null;
  readonly rootAgentId: string | null;
  readonly rootSessionId: string | null;
  readonly conductorAgentId?: string;
  readonly conductorSessionId?: string;
  readonly coordinationId?: string;
  readonly status: 'root' | 'linked' | 'orphan';
}

export const workerAncestrySchema = z.object({
  agentId: z.string(), sessionId: z.string(),
  parentAgentId: z.string().nullable(), parentSessionId: z.string().nullable(),
  rootAgentId: z.string().nullable(), rootSessionId: z.string().nullable(),
  conductorAgentId: z.string().optional(), conductorSessionId: z.string().optional(),
  coordinationId: z.string().optional(), status: z.enum(['root', 'linked', 'orphan']),
}) satisfies z.ZodType<WorkerAncestry>;
