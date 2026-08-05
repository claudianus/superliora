import { z } from 'zod';

export const memoryTypeSchema = z.enum(['fact', 'event', 'procedure', 'task', 'rule']);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const memoryEpistemicSchema = z.enum(['direct', 'inferred', 'preference', 'summary']);
export type MemoryEpistemic = z.infer<typeof memoryEpistemicSchema>;

export const memoryScopeSchema = z.enum(['user', 'workspace', 'session']);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryStatusSchema = z.enum(['candidate', 'active', 'archived', 'superseded', 'deleted']);
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;

export const memorySourceRefSchema = z.object({
  kind: z.enum(['user', 'tool', 'auto', 'import', 'system']),
  session_id: z.string().optional(),
  agent_id: z.string().optional(),
  turn_id: z.number().optional(),
  message_id: z.string().optional(),
  excerpt: z.string().optional(),
});
export type MemorySourceRef = z.infer<typeof memorySourceRefSchema>;

export const memoryEvidenceRefSchema = z.object({
  kind: z.enum(['file', 'symbol', 'run', 'message', 'memory', 'url']),
  id: z.string().min(1),
  excerpt: z.string().optional(),
  sha256: z.string().optional(),
});
export type MemoryEvidenceRef = z.infer<typeof memoryEvidenceRefSchema>;

export const memoryLinkSchema = z.object({
  target_kind: z.enum(['memory', 'file', 'symbol', 'run', 'evidence']),
  target_id: z.string().min(1),
  relation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  valid_from: z.number().optional(),
  valid_to: z.number().optional(),
  source: memorySourceRefSchema.optional(),
});
export type MemoryLink = z.infer<typeof memoryLinkSchema>;

export const memoryRecordSchema = z.object({
  id: z.string().min(1),
  type: memoryTypeSchema,
  epistemic: memoryEpistemicSchema,
  scope: memoryScopeSchema,
  scope_key: z.string().optional(),
  subject: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  status: memoryStatusSchema,
  source: memorySourceRefSchema,
  created_at: z.number(),
  updated_at: z.number(),
  recorded_at: z.number(),
  accessed_at: z.number().optional(),
  access_count: z.number(),
  valid_from: z.number().optional(),
  valid_to: z.number().optional(),
  invalid_at: z.number().optional(),
  supersedes: z.array(z.string()),
  superseded_by: z.string().optional(),
  evidence_refs: z.array(memoryEvidenceRefSchema),
  links: z.array(memoryLinkSchema),
  metadata: z.record(z.string(), z.unknown()),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export const memorySearchResultSchema = z.object({
  memory: memoryRecordSchema,
  score: z.number(),
  reasons: z.array(z.string()),
  link_path: z.array(z.string()).optional(),
  abstained: z.boolean().optional(),
  abstention_reason: z.string().optional(),
});
export type MemorySearchResult = z.infer<typeof memorySearchResultSchema>;
