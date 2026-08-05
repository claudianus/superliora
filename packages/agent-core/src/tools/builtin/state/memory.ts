import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import type {
  AgentMemoryRuntime,
  MemoryCreateInput,
  MemoryEpistemic,
  MemoryEvidenceRef,
  MemoryLink,
  MemoryType,
  MemoryRecord,
  MemorySearchRequest,
  MemoryScope,
  MemorySearchResult,
} from '../../../memory';
import { toInputJsonSchema } from '../../support/input-schema';

export const MEMORY_TOOL_NAME = 'Memory' as const;

const MemoryTypeSchema = z.enum(['fact', 'event', 'procedure', 'task', 'rule']);
const MemoryEpistemicSchema = z.enum(['direct', 'inferred', 'preference', 'summary']);
const MemoryScopeSchema = z.enum(['user', 'workspace', 'session']);

/**
 * SOTA harness Phase C: Instruction (human/repo SSOT) vs Learning (ACE deltas).
 * Stored as tags `layer:instruction` / `layer:learning` for list/search filters.
 */
export const MEMORY_LAYER_TAGS = {
  instruction: 'layer:instruction',
  learning: 'layer:learning',
} as const;

export type MemoryLayer = keyof typeof MEMORY_LAYER_TAGS;

const RememberMemorySchema = z.object({
  subject: z.string().min(1).describe('Short subject for the memory.'),
  content: z.string().min(1).describe('The durable fact, preference, decision, reminder, or work note to remember.'),
  type: MemoryTypeSchema.optional().describe('Memory type. Defaults to fact.'),
  epistemic: MemoryEpistemicSchema.optional().describe('Whether the memory is direct, inferred, a preference, or a summary.'),
  scope: MemoryScopeSchema.optional().describe('Visibility scope. Defaults by memory type.'),
  /**
   * instruction = stable human/repo rules; learning = session-earned deltas
   * (default). Prefer this over free-form tags alone.
   */
  layer: z
    .enum(['instruction', 'learning'])
    .optional()
    .describe(
      'instruction = durable human/repo SSOT rules; learning = experience deltas (default). Tagged as layer:* .',
    ),
  tags: z.array(z.string().min(1)).optional().describe('Search tags.'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence from 0 to 1.'),
  importance: z.number().min(0).max(1).optional().describe('Importance from 0 to 1.'),
  valid_from: z.number().optional(),
  valid_to: z.number().optional(),
  evidence_refs: z
    .array(z.object({ kind: z.enum(['file', 'symbol', 'run', 'message', 'memory', 'url']), id: z.string().min(1), excerpt: z.string().optional(), sha256: z.string().optional() }))
    .optional(),
  links: z
    .array(
      z.object({
        target_kind: z.enum(['memory', 'file', 'symbol', 'run', 'evidence']),
        target_id: z.string().min(1),
        relation: z.string().min(1),
        confidence: z.number().min(0).max(1),
        valid_from: z.number().optional(),
        valid_to: z.number().optional(),
      }),
    )
    .optional()
    .describe('Provenance edges; RepoQuery derived_links can be copied here.'),
});

const RecallMemorySchema = z.object({
  query: z.string().min(1).describe('Search query.'),
  type: MemoryTypeSchema.optional().describe('Optional memory type filter.'),
  limit: z.number().int().min(1).max(20).optional().describe('Maximum memories to return.'),
  token_budget: z.number().int().min(1).max(16_000).optional(),
  as_of: z.number().optional(),
  include_archived: z.boolean().optional(),
  include_deleted: z.boolean().optional(),
  include_candidates: z.boolean().optional(),
  expand_links: z.boolean().optional(),
});

const InspectMemorySchema = z.object({
  id: z.string().min(1).describe('Memory id to read.'),
}).partial();

const ForgetMemorySchema = z.object({
  id: z.string().min(1).describe('Memory id to forget.'),
});

export interface MemoryInput {
  readonly remember?: z.infer<typeof RememberMemorySchema>;
  readonly recall?: z.infer<typeof RecallMemorySchema>;
  readonly inspect?: z.infer<typeof InspectMemorySchema>;
  readonly reflect?: { readonly dryRun?: boolean };
  readonly forget?: z.infer<typeof ForgetMemorySchema>;
}

export const MemoryInputSchema: z.ZodType<MemoryInput> = z.object({
  remember: RememberMemorySchema.optional().describe('Remember a durable Liora Memory record.'),
  recall: RecallMemorySchema.optional().describe('Recall Liora Memory records.'),
  inspect: InspectMemorySchema.optional().describe('Inspect Liora Memory or one record by id.'),
  reflect: z.object({ dryRun: z.boolean().optional() }).optional().describe('Reflect over candidate memories.'),
  forget: ForgetMemorySchema.optional().describe('Forget a memory by id.'),
});

export class MemoryTool implements BuiltinTool<MemoryInput> {
  readonly name = MEMORY_TOOL_NAME;
  readonly description =
    'Remember, recall, reflect, forget, and inspect durable Liora Memory across sessions. Use for stable preferences, project decisions, reminders, and important work continuity.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(MemoryInputSchema);

  constructor(private readonly memory: AgentMemoryRuntime) {}

  resolveExecution(args: MemoryInput): ToolExecution {
    const action = actionName(args);
    return {
      accesses: memoryAccesses(args),
      description: `${action} Liora Memory`,
      approvalRule: this.name,
      execute: async () => {
        if (!this.memory.isEnabled()) {
          return { isError: true, output: 'Liora Memory is disabled by config.' };
        }
        if (args.remember !== undefined) {
          const saved = await this.memory.remember(toCreateInput(args.remember));
          return { isError: false, output: `Memory saved: ${saved.id}\n${renderMemory(saved)}` };
        }
        if (args.recall !== undefined) {
          const results = await this.memory.recall(toRecallRequest(args.recall));
          return { isError: false, output: renderSearchResults(results) };
        }
        if (args.inspect !== undefined) {
          if (args.inspect.id !== undefined) {
            const memory = await this.memory.get(args.inspect.id);
            return { isError: false, output: memory === undefined ? `No memory found: ${args.inspect.id}` : renderMemory(memory) };
          }
          return { isError: false, output: JSON.stringify(await this.memory.inspect(), null, 2) };
        }
        if (args.reflect !== undefined) {
          const result = await this.memory.reflect(args.reflect);
          return { isError: false, output: JSON.stringify(result) };
        }
        if (args.forget !== undefined) {
          const forgotten = await this.memory.forget(args.forget.id);
          return { isError: false, output: forgotten ? `Memory forgotten: ${args.forget.id}` : `No memory found: ${args.forget.id}` };
        }
        return { isError: true, output: 'Choose one Memory operation.' };
      },
    };
  }
}

function actionName(args: MemoryInput): string {
  if (args.remember !== undefined) {
    const layer = args.remember.layer ?? 'learning';
    return `Writing (${layer})`;
  }
  if (args.recall !== undefined) return 'Recalling';
  if (args.inspect !== undefined) return 'Inspecting';
  if (args.reflect !== undefined) return 'Reflecting';
  if (args.forget !== undefined) return 'Forgetting';
  return 'Listing';
}

function memoryAccesses(args: MemoryInput) {
  return args.remember !== undefined || args.forget !== undefined || args.reflect !== undefined
    ? ToolAccesses.all()
    : ToolAccesses.none();
}

function toCreateInput(input: z.infer<typeof RememberMemorySchema>): MemoryCreateInput {
  const layer: MemoryLayer = input.layer ?? 'learning';
  return {
    type: (input.type ?? 'fact') as MemoryType,
    epistemic: input.epistemic as MemoryEpistemic | undefined,
    scope: input.scope as MemoryScope | undefined,
    subject: input.subject,
    content: input.content,
    tags: mergeLayerTag(input.tags, MEMORY_LAYER_TAGS[layer]),
    confidence: input.confidence,
    importance: input.importance,
    validFrom: input.valid_from,
    validTo: input.valid_to,
    evidenceRefs: input.evidence_refs?.map((ref) => ({
      kind: ref.kind,
      id: ref.id,
      ...(ref.excerpt === undefined ? {} : { excerpt: ref.excerpt }),
      ...(ref.sha256 === undefined ? {} : { sha256: ref.sha256 }),
    })) as readonly MemoryEvidenceRef[] | undefined,
    links: input.links?.map((link) => ({
      targetKind: link.target_kind,
      targetId: link.target_id,
      relation: link.relation,
      confidence: link.confidence,
      ...(link.valid_from === undefined ? {} : { validFrom: link.valid_from }),
      ...(link.valid_to === undefined ? {} : { validTo: link.valid_to }),
    })) as readonly MemoryLink[] | undefined,
  };
}

function toRecallRequest(
  input: z.infer<typeof RecallMemorySchema>,
): MemorySearchRequest {
  return {
    query: input.query,
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.token_budget === undefined ? {} : { tokenBudget: input.token_budget }),
    ...(input.as_of === undefined ? {} : { asOf: input.as_of }),
    ...(input.include_archived === undefined ? {} : { includeArchived: input.include_archived }),
    ...(input.include_deleted === undefined ? {} : { includeDeleted: input.include_deleted }),
    ...(input.include_candidates === undefined ? {} : { includeCandidates: input.include_candidates }),
    ...(input.expand_links === undefined ? {} : { expandLinks: input.expand_links }),
  };
}

/** Ensure layer:* tag is present once; user tags follow. */
export function mergeLayerTag(
  tags: readonly string[] | undefined,
  layerTag: string,
): string[] {
  const rest = (tags ?? []).filter(
    (tag) => tag !== MEMORY_LAYER_TAGS.instruction && tag !== MEMORY_LAYER_TAGS.learning,
  );
  return [layerTag, ...rest];
}

function renderSearchResults(results: readonly MemorySearchResult[]): string {
  if (results.length === 0) return 'No matching Liora Memory.';
  const recalled = results.filter((result) => result.abstained !== true);
  if (recalled.length === 0) {
    return `Liora Memory abstained: ${results[0]?.abstentionReason ?? 'no result met the recall boundary.'}`;
  }
  return results
    .filter((result) => result.abstained !== true)
    .map((result, index) => `${index + 1}. score=${result.score.toFixed(2)} ${renderMemory(result.memory)}`)
    .join('\n\n');
}

function renderMemory(memory: MemoryRecord): string {
  const tags = memory.tags.length > 0 ? ` tags=${memory.tags.join(',')}` : '';
  const layer =
    memory.tags.includes(MEMORY_LAYER_TAGS.instruction)
      ? ' layer=instruction'
      : memory.tags.includes(MEMORY_LAYER_TAGS.learning)
        ? ' layer=learning'
        : '';
  return `[${memory.id}] ${memory.type}/${memory.scope}${layer}${tags}\nSubject: ${memory.subject}\nContent: ${memory.content}`;
}
