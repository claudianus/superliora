import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import type {
  AgentMemoryRuntime,
  MemoryCreateInput,
  MemoryKind,
  MemoryRecord,
  MemoryScope,
  MemorySearchResult,
} from '../../../memory';
import { toInputJsonSchema } from '../../support/input-schema';

export const MEMORY_TOOL_NAME = 'Memory' as const;

const MemoryKindSchema = z.enum(['semantic', 'episodic', 'procedural', 'prospective', 'governance']);
const MemoryScopeSchema = z.enum(['user', 'workspace', 'session']);

const WriteMemorySchema = z.object({
  subject: z.string().min(1).describe('Short subject for the memory.'),
  content: z.string().min(1).describe('The durable fact, preference, decision, reminder, or work note to remember.'),
  kind: MemoryKindSchema.optional().describe('Memory kind. Defaults to semantic.'),
  scope: MemoryScopeSchema.optional().describe('Visibility scope. Defaults by memory kind.'),
  tags: z.array(z.string().min(1)).optional().describe('Search tags.'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence from 0 to 1.'),
  importance: z.number().min(0).max(1).optional().describe('Importance from 0 to 1.'),
});

const SearchMemorySchema = z.object({
  query: z.string().min(1).describe('Search query.'),
  kind: MemoryKindSchema.optional().describe('Optional memory kind filter.'),
  limit: z.number().int().min(1).max(20).optional().describe('Maximum memories to return.'),
});

const ReadMemorySchema = z.object({
  id: z.string().min(1).describe('Memory id to read.'),
});

const ForgetMemorySchema = z.object({
  id: z.string().min(1).describe('Memory id to forget.'),
});

const ListMemorySchema = z.object({
  kind: MemoryKindSchema.optional().describe('Optional memory kind filter.'),
  scope: MemoryScopeSchema.optional().describe('Optional memory scope filter.'),
  limit: z.number().int().min(1).max(50).optional().describe('Maximum memories to list.'),
});

export interface MemoryInput {
  readonly write?: z.infer<typeof WriteMemorySchema>;
  readonly search?: z.infer<typeof SearchMemorySchema>;
  readonly read?: z.infer<typeof ReadMemorySchema>;
  readonly forget?: z.infer<typeof ForgetMemorySchema>;
  readonly list?: z.infer<typeof ListMemorySchema>;
}

export const MemoryInputSchema: z.ZodType<MemoryInput> = z.object({
  write: WriteMemorySchema.optional().describe('Create a durable Liora Recall memory.'),
  search: SearchMemorySchema.optional().describe('Search Liora Recall.'),
  read: ReadMemorySchema.optional().describe('Read a specific Liora Recall memory by id.'),
  forget: ForgetMemorySchema.optional().describe('Forget a memory by id.'),
  list: ListMemorySchema.optional().describe('List recent Liora Recall memories.'),
});

export class MemoryTool implements BuiltinTool<MemoryInput> {
  readonly name = MEMORY_TOOL_NAME;
  readonly description =
    'Read, search, write, and forget durable Liora Recall memories that persist across sessions and context compactions. Use this for stable user preferences, project decisions, reminders, and important work continuity notes.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(MemoryInputSchema);

  constructor(private readonly memory: AgentMemoryRuntime) {}

  resolveExecution(args: MemoryInput): ToolExecution {
    const action = actionName(args);
    return {
      description: `${action} Liora Recall`,
      approvalRule: this.name,
      execute: async () => {
        if (!this.memory.isEnabled()) {
          return { isError: true, output: 'Liora Recall is disabled by config.' };
        }
        if (args.write !== undefined) {
          const saved = await this.memory.remember(toCreateInput(args.write));
          return { isError: false, output: `Memory saved: ${saved.id}\n${renderMemory(saved)}` };
        }
        if (args.search !== undefined) {
          const results = await this.memory.search(args.search);
          return { isError: false, output: renderSearchResults(results) };
        }
        if (args.read !== undefined) {
          const memory = await this.memory.get(args.read.id);
          return { isError: false, output: memory === undefined ? `No memory found: ${args.read.id}` : renderMemory(memory) };
        }
        if (args.forget !== undefined) {
          const forgotten = await this.memory.forget(args.forget.id);
          return { isError: false, output: forgotten ? `Memory forgotten: ${args.forget.id}` : `No memory found: ${args.forget.id}` };
        }
        const memories = await this.memory.list(args.list ?? {});
        return { isError: false, output: renderList(memories) };
      },
    };
  }
}

function actionName(args: MemoryInput): string {
  if (args.write !== undefined) return 'Writing';
  if (args.search !== undefined) return 'Searching';
  if (args.read !== undefined) return 'Reading';
  if (args.forget !== undefined) return 'Forgetting';
  return 'Listing';
}

function toCreateInput(input: z.infer<typeof WriteMemorySchema>): MemoryCreateInput {
  return {
    kind: (input.kind ?? 'semantic') as MemoryKind,
    scope: input.scope as MemoryScope | undefined,
    subject: input.subject,
    content: input.content,
    tags: input.tags,
    confidence: input.confidence,
    importance: input.importance,
  };
}

function renderSearchResults(results: readonly MemorySearchResult[]): string {
  if (results.length === 0) return 'No matching Liora Recall memories.';
  return results
    .map((result, index) => `${index + 1}. score=${result.score.toFixed(2)} ${renderMemory(result.memory)}`)
    .join('\n\n');
}

function renderList(memories: readonly MemoryRecord[]): string {
  if (memories.length === 0) return 'No Liora Recall memories stored yet.';
  return memories.map((memory, index) => `${index + 1}. ${renderMemory(memory)}`).join('\n\n');
}

function renderMemory(memory: MemoryRecord): string {
  const tags = memory.tags.length > 0 ? ` tags=${memory.tags.join(',')}` : '';
  return `[${memory.id}] ${memory.kind}/${memory.scope}${tags}\nSubject: ${memory.subject}\nContent: ${memory.content}`;
}
