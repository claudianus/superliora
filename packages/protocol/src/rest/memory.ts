import { z } from 'zod';

import {
  memoryEpistemicSchema,
  memoryEvidenceRefSchema,
  memoryLinkSchema,
  memoryRecordSchema,
  memoryScopeSchema,
  memorySearchResultSchema,
  memoryStatusSchema,
  memoryTypeSchema,
} from '../memory';

export const listMemoriesQuerySchema = z.object({
  type: memoryTypeSchema.optional(),
  scope: memoryScopeSchema.optional(),
  scope_key: z.string().min(1).optional(),
  status: memoryStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListMemoriesQuery = z.infer<typeof listMemoriesQuerySchema>;

export const searchMemoriesRequestSchema = z.object({
  query: z.string().optional(),
  type: memoryTypeSchema.optional(),
  types: z.array(memoryTypeSchema).optional(),
  scope: memoryScopeSchema.optional(),
  scope_key: z.string().min(1).optional(),
  workspace_key: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  token_budget: z.number().int().min(1).max(16_000).optional(),
  as_of: z.number().optional(),
  include_archived: z.boolean().optional(),
  include_deleted: z.boolean().optional(),
  include_candidates: z.boolean().optional(),
  expand_links: z.boolean().optional(),
});
export type SearchMemoriesRequest = z.infer<typeof searchMemoriesRequestSchema>;

export const createMemoryRequestSchema = z.object({
  type: memoryTypeSchema,
  epistemic: memoryEpistemicSchema.optional(),
  scope: memoryScopeSchema.optional(),
  scope_key: z.string().min(1).optional(),
  subject: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  valid_from: z.number().optional(),
  valid_to: z.number().optional(),
  evidence_refs: z.array(memoryEvidenceRefSchema).optional(),
  links: z.array(memoryLinkSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>;

export const updateMemoryRequestSchema = createMemoryRequestSchema.partial().extend({
  status: memoryStatusSchema.optional(),
  invalid_at: z.number().optional(),
  superseded_by: z.string().min(1).optional(),
});
export type UpdateMemoryRequest = z.infer<typeof updateMemoryRequestSchema>;

export const importMemoriesRequestSchema = z.object({
  records: z.array(z.unknown()),
});
export type ImportMemoriesRequest = z.infer<typeof importMemoriesRequestSchema>;

export const listMemoriesResponseSchema = z.object({ memories: z.array(memoryRecordSchema) });
export const getMemoryResponseSchema = z.object({ memory: memoryRecordSchema.nullable() });
export const createMemoryResponseSchema = z.object({ memory: memoryRecordSchema });
export const updateMemoryResponseSchema = z.object({ memory: memoryRecordSchema });
export const searchMemoriesResponseSchema = z.object({ memories: z.array(memorySearchResultSchema) });
export const forgetMemoryResponseSchema = z.object({ forgotten: z.boolean() });
export const memoryStatsResponseSchema = z.object({ stats: z.unknown() });
export const exportMemoriesResponseSchema = z.object({
  exported_at: z.number(),
  schema_version: z.literal(2),
  records: z.array(memoryRecordSchema),
});
export const importMemoriesResponseSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  updated: z.number(),
});
export const reflectMemoriesResponseSchema = z.object({
  examined: z.number(),
  merged: z.number(),
  promoted: z.number(),
  rejected: z.number(),
});
export const reflectMemoriesRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  dry_run: z.boolean().optional(),
  force: z.boolean().optional(),
});
export const inspectMemoryResponseSchema = z.object({
  store_path: z.string(),
  schema_version: z.number(),
  integrity: z.object({ ok: z.boolean(), issues: z.array(z.string()) }),
  stats: z.unknown(),
  recent_events: z.array(
    z.object({
      id: z.string(),
      memory_id: z.string(),
      action: z.string(),
      source: z.unknown(),
      created_at: z.number(),
    }),
  ),
});
