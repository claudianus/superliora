import { IMemoryService, type IInstantiationService, type MemoryCreateInput, type MemoryEvidenceRef, type MemoryLink, type MemoryListRequest, type MemoryRecord as CoreMemoryRecord, type MemoryReflectInput, type MemorySearchRequest, type MemorySearchResult, type MemorySourceRef, type MemoryUpdateInput } from '@superliora/agent-core';
import {
  createMemoryRequestSchema,
  createMemoryResponseSchema,
  exportMemoriesResponseSchema,
  forgetMemoryResponseSchema,
  getMemoryResponseSchema,
  importMemoriesRequestSchema,
  importMemoriesResponseSchema,
  inspectMemoryResponseSchema,
  listMemoriesQuerySchema,
  listMemoriesResponseSchema,
  memoryEvidenceRefSchema,
  memoryLinkSchema,
  memoryStatsResponseSchema,
  searchMemoriesRequestSchema,
  searchMemoriesResponseSchema,
  reflectMemoriesResponseSchema,
  reflectMemoriesRequestSchema,
  updateMemoryRequestSchema,
  updateMemoryResponseSchema,
  type MemoryRecord,
  type MemorySourceRef as RestMemorySourceRef,
} from '@superliora/protocol';
import { z } from 'zod';

import { okEnvelope } from '../../envelope';
import { defineRoute } from '../../middleware/defineRoute';

interface MemoriesRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; query: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  patch(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  delete(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

const memoryIdParamSchema = z.object({ memory_id: z.string().min(1) });

export function registerMemoriesRoutes(app: MemoriesRouteHost, ix: IInstantiationService): void {
  const listRoute = defineRoute(
    {
      method: 'GET',
      path: '/memories',
      querystring: listMemoriesQuerySchema,
      success: { data: listMemoriesResponseSchema },
      description: 'List Liora Memory records',
      tags: ['memories'],
      operationId: 'listMemories',
    },
    async (req, reply) => {
      const memories = await ix.invokeFunction((a) => a.get(IMemoryService).list(toListRequest(req.query)));
      reply.send(okEnvelope({ memories: memories.map(toRestMemory) }, req.id));
    },
  );
  app.get(listRoute.path, listRoute.options, listRoute.handler as Parameters<MemoriesRouteHost['get']>[2]);

  const recallRoute = defineRoute(
    {
      method: 'POST',
      path: '/memories::recall',
      body: searchMemoriesRequestSchema,
      success: { data: searchMemoriesResponseSchema },
      description: 'Recall Liora Memory records',
      tags: ['memories'],
      operationId: 'recallMemories',
    },
    async (req, reply) => {
      const results = await ix.invokeFunction((a) => a.get(IMemoryService).recall(toSearchRequest(req.body)));
      reply.send(okEnvelope({ memories: results.map(toRestSearchResult) }, req.id));
    },
  );
  app.post(recallRoute.path, recallRoute.options, recallRoute.handler as Parameters<MemoriesRouteHost['post']>[2]);

  const createRoute = defineRoute(
    {
      method: 'POST',
      path: '/memories::remember',
      body: createMemoryRequestSchema,
      success: { data: createMemoryResponseSchema },
      description: 'Remember a Liora Memory record',
      tags: ['memories'],
      operationId: 'rememberMemory',
    },
    async (req, reply) => {
      const memory = await ix.invokeFunction((a) => a.get(IMemoryService).remember(toCreateInput(req.body)));
      reply.send(okEnvelope({ memory: toRestMemory(memory) }, req.id));
    },
  );
  app.post(createRoute.path, createRoute.options, createRoute.handler as Parameters<MemoriesRouteHost['post']>[2]);

  const getRoute = defineRoute(
    {
      method: 'GET',
      path: '/memories/{memory_id}',
      params: memoryIdParamSchema,
      success: { data: getMemoryResponseSchema },
      description: 'Get a Liora Memory record',
      tags: ['memories'],
      operationId: 'getMemory',
    },
    async (req, reply) => {
      const { memory_id } = req.params;
      const memory = await ix.invokeFunction((a) => a.get(IMemoryService).get(memory_id));
      reply.send(okEnvelope({ memory: memory === undefined ? null : toRestMemory(memory) }, req.id));
    },
  );
  app.get(getRoute.path, getRoute.options, getRoute.handler as Parameters<MemoriesRouteHost['get']>[2]);

  const updateRoute = defineRoute(
    {
      method: 'PATCH',
      path: '/memories/{memory_id}',
      params: memoryIdParamSchema,
      body: updateMemoryRequestSchema,
      success: { data: updateMemoryResponseSchema },
      description: 'Update a Liora Memory record',
      tags: ['memories'],
      operationId: 'updateMemory',
    },
    async (req, reply) => {
      const { memory_id } = req.params;
      const memory = await ix.invokeFunction((a) => a.get(IMemoryService).update(memory_id, toUpdateInput(req.body)));
      reply.send(okEnvelope({ memory: toRestMemory(memory) }, req.id));
    },
  );
  app.patch(updateRoute.path, updateRoute.options, updateRoute.handler as Parameters<MemoriesRouteHost['patch']>[2]);

  const deleteRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/memories/{memory_id}',
      params: memoryIdParamSchema,
      success: { data: forgetMemoryResponseSchema },
      description: 'Forget a Liora Memory record',
      tags: ['memories'],
      operationId: 'forgetMemory',
    },
    async (req, reply) => {
      const { memory_id } = req.params;
      const forgotten = await ix.invokeFunction((a) => a.get(IMemoryService).forget(memory_id));
      reply.send(okEnvelope({ forgotten }, req.id));
    },
  );
  app.delete(deleteRoute.path, deleteRoute.options, deleteRoute.handler as Parameters<MemoriesRouteHost['delete']>[2]);

  const statsRoute = defineRoute(
    {
      method: 'GET',
      path: '/memories/stats',
      success: { data: memoryStatsResponseSchema },
      description: 'Get Liora Memory stats',
      tags: ['memories'],
      operationId: 'memoryStats',
    },
    async (req, reply) => {
      const stats = await ix.invokeFunction((a) => a.get(IMemoryService).stats());
      reply.send(okEnvelope({ stats }, req.id));
    },
  );
  app.get(statsRoute.path, statsRoute.options, statsRoute.handler as Parameters<MemoriesRouteHost['get']>[2]);

  const exportRoute = defineRoute(
    {
      method: 'POST',
      path: '/memories::export',
      body: listMemoriesQuerySchema.partial(),
      success: { data: exportMemoriesResponseSchema },
      description: 'Export Liora Memory records',
      tags: ['memories'],
      operationId: 'exportMemories',
    },
    async (req, reply) => {
      const exported = await ix.invokeFunction((a) => a.get(IMemoryService).exportMemories(toListRequest(req.body)));
      reply.send(okEnvelope({ exported_at: exported.exportedAt, schema_version: exported.schemaVersion, records: exported.records.map(toRestMemory) }, req.id));
    },
  );
  app.post(exportRoute.path, exportRoute.options, exportRoute.handler as Parameters<MemoriesRouteHost['post']>[2]);

  const importRoute = defineRoute(
    {
      method: 'POST',
      path: '/memories::import',
      body: importMemoriesRequestSchema,
      success: { data: importMemoriesResponseSchema },
      description: 'Import Liora Memory records',
      tags: ['memories'],
      operationId: 'importMemories',
    },
    async (req, reply) => {
      const result = await ix.invokeFunction((a) => a.get(IMemoryService).importMemories(req.body.records as CoreMemoryRecord[]));
      reply.send(okEnvelope(result, req.id));
    },
  );
  app.post(importRoute.path, importRoute.options, importRoute.handler as Parameters<MemoriesRouteHost['post']>[2]);

  const reflectRoute = defineRoute(
    {
      method: 'POST',
      path: '/memories::reflect',
      body: reflectMemoriesRequestSchema,
      success: { data: reflectMemoriesResponseSchema },
      description: 'Reflect over Liora Memory candidates',
      tags: ['memories'],
      operationId: 'reflectMemories',
    },
    async (req, reply) => {
      const result = await ix.invokeFunction((a) =>
        a.get(IMemoryService).reflect(toReflectInput(req.body)),
      );
      reply.send(okEnvelope(result, req.id));
    },
  );
  app.post(reflectRoute.path, reflectRoute.options, reflectRoute.handler as Parameters<MemoriesRouteHost['post']>[2]);

  const inspectRoute = defineRoute(
    {
      method: 'GET',
      path: '/memories/inspect',
      success: { data: inspectMemoryResponseSchema },
      description: 'Inspect Liora Memory health and audit',
      tags: ['memories'],
      operationId: 'inspectMemory',
    },
    async (req, reply) => {
      const result = await ix.invokeFunction((a) => a.get(IMemoryService).inspect());
      reply.send(
        okEnvelope(
          {
            store_path: result.storePath,
            schema_version: result.schemaVersion,
            integrity: result.integrity,
            stats: result.stats,
            recent_events: result.recentEvents,
          },
          req.id,
        ),
      );
    },
  );
  app.get(inspectRoute.path, inspectRoute.options, inspectRoute.handler as Parameters<MemoriesRouteHost['get']>[2]);
}

function toSearchRequest(input: z.infer<typeof searchMemoriesRequestSchema>): MemorySearchRequest {
  const request: Mutable<MemorySearchRequest> = {};
  if (input.query !== undefined) request.query = input.query;
  if (input.type !== undefined) request.type = input.type;
  if (input.types !== undefined) request.types = input.types;
  if (input.scope !== undefined) request.scope = input.scope;
  if (input.scope_key !== undefined) request.scopeKey = input.scope_key;
  if (input.workspace_key !== undefined) request.workspaceKey = input.workspace_key;
  if (input.session_id !== undefined) request.sessionId = input.session_id;
  if (input.tags !== undefined) request.tags = input.tags;
  if (input.limit !== undefined) request.limit = input.limit;
  if (input.token_budget !== undefined) request.tokenBudget = input.token_budget;
  if (input.as_of !== undefined) request.asOf = input.as_of;
  if (input.include_archived !== undefined) request.includeArchived = input.include_archived;
  if (input.include_deleted !== undefined) request.includeDeleted = input.include_deleted;
  if (input.include_candidates !== undefined) request.includeCandidates = input.include_candidates;
  if (input.expand_links !== undefined) request.expandLinks = input.expand_links;
  return request;
}

function toListRequest(input: z.infer<typeof listMemoriesQuerySchema>): MemoryListRequest {
  const request: Mutable<MemoryListRequest> = {};
  if (input.type !== undefined) request.type = input.type;
  if (input.scope !== undefined) request.scope = input.scope;
  if (input.scope_key !== undefined) request.scopeKey = input.scope_key;
  if (input.status !== undefined) request.status = input.status;
  if (input.tags !== undefined) request.tags = input.tags;
  if (input.limit !== undefined) request.limit = input.limit;
  if (input.offset !== undefined) request.offset = input.offset;
  return request;
}

function toCreateInput(input: z.infer<typeof createMemoryRequestSchema>): MemoryCreateInput {
  const request: Mutable<MemoryCreateInput> = {
    type: input.type,
    subject: input.subject,
    content: input.content,
  };
  if (input.epistemic !== undefined) request.epistemic = input.epistemic;
  if (input.scope !== undefined) request.scope = input.scope;
  if (input.scope_key !== undefined) request.scopeKey = input.scope_key;
  if (input.tags !== undefined) request.tags = input.tags;
  if (input.confidence !== undefined) request.confidence = input.confidence;
  if (input.importance !== undefined) request.importance = input.importance;
  if (input.valid_from !== undefined) request.validFrom = input.valid_from;
  if (input.valid_to !== undefined) request.validTo = input.valid_to;
  if (input.evidence_refs !== undefined) request.evidenceRefs = input.evidence_refs.map(toCoreEvidenceRef);
  if (input.links !== undefined) request.links = input.links.map(toCoreLink);
  if (input.metadata !== undefined) request.metadata = input.metadata;
  return request;
}

function toUpdateInput(input: z.infer<typeof updateMemoryRequestSchema>): MemoryUpdateInput {
  const request: Mutable<MemoryUpdateInput> = {};
  if (input.type !== undefined) request.type = input.type;
  if (input.epistemic !== undefined) request.epistemic = input.epistemic;
  if (input.scope !== undefined) request.scope = input.scope;
  if (input.scope_key !== undefined) request.scopeKey = input.scope_key;
  if (input.subject !== undefined) request.subject = input.subject;
  if (input.content !== undefined) request.content = input.content;
  if (input.tags !== undefined) request.tags = input.tags;
  if (input.confidence !== undefined) request.confidence = input.confidence;
  if (input.importance !== undefined) request.importance = input.importance;
  if (input.status !== undefined) request.status = input.status;
  if (input.valid_from !== undefined) request.validFrom = input.valid_from;
  if (input.valid_to !== undefined) request.validTo = input.valid_to;
  if (input.invalid_at !== undefined) request.invalidAt = input.invalid_at;
  if (input.superseded_by !== undefined) request.supersededBy = input.superseded_by;
  if (input.evidence_refs !== undefined) request.evidenceRefs = input.evidence_refs.map(toCoreEvidenceRef);
  if (input.links !== undefined) request.links = input.links.map(toCoreLink);
  if (input.metadata !== undefined) request.metadata = input.metadata;
  return request;
}

function toReflectInput(
  input: z.infer<typeof reflectMemoriesRequestSchema>,
): MemoryReflectInput {
  return {
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.dry_run === undefined ? {} : { dryRun: input.dry_run }),
    ...(input.force === undefined ? {} : { force: input.force }),
  };
}

function toRestSearchResult(result: MemorySearchResult): z.infer<typeof searchMemoriesResponseSchema>['memories'][number] {
  return {
    memory: toRestMemory(result.memory),
    score: result.score,
    reasons: [...result.reasons],
    ...(result.linkPath === undefined ? {} : { link_path: [...result.linkPath] }),
    ...(result.abstained === undefined ? {} : { abstained: result.abstained }),
    ...(result.abstentionReason === undefined ? {} : { abstention_reason: result.abstentionReason }),
  };
}

function toRestMemory(memory: CoreMemoryRecord): MemoryRecord {
  const response: Mutable<MemoryRecord> = {
    id: memory.id,
    type: memory.type,
    epistemic: memory.epistemic,
    scope: memory.scope,
    subject: memory.subject,
    content: memory.content,
    tags: [...memory.tags],
    confidence: memory.confidence,
    importance: memory.importance,
    status: memory.status,
    source: toRestSource(memory.source),
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
    recorded_at: memory.recordedAt,
    access_count: memory.accessCount,
    supersedes: [...memory.supersedes],
    evidence_refs: memory.evidenceRefs.map((ref) => ({ ...ref })),
    links: memory.links.map((link) => ({
      target_kind: link.targetKind,
      target_id: link.targetId,
      relation: link.relation,
      confidence: link.confidence,
      ...(link.validFrom === undefined ? {} : { valid_from: link.validFrom }),
      ...(link.validTo === undefined ? {} : { valid_to: link.validTo }),
      ...(link.source === undefined ? {} : { source: toRestSource(link.source) }),
    })),
    metadata: memory.metadata,
  };
  if (memory.scopeKey !== undefined) response.scope_key = memory.scopeKey;
  if (memory.accessedAt !== undefined) response.accessed_at = memory.accessedAt;
  if (memory.validFrom !== undefined) response.valid_from = memory.validFrom;
  if (memory.validTo !== undefined) response.valid_to = memory.validTo;
  if (memory.invalidAt !== undefined) response.invalid_at = memory.invalidAt;
  if (memory.supersededBy !== undefined) response.superseded_by = memory.supersededBy;
  return response;
}

function toRestSource(source: MemorySourceRef): RestMemorySourceRef {
  const response: Mutable<RestMemorySourceRef> = { kind: source.kind };
  if (source.sessionId !== undefined) response.session_id = source.sessionId;
  if (source.agentId !== undefined) response.agent_id = source.agentId;
  if (source.turnId !== undefined) response.turn_id = source.turnId;
  if (source.messageId !== undefined) response.message_id = source.messageId;
  if (source.excerpt !== undefined) response.excerpt = source.excerpt;
  return response;
}

function toCoreEvidenceRef(input: z.infer<typeof memoryEvidenceRefSchema>): MemoryEvidenceRef {
  return {
    kind: input.kind,
    id: input.id,
    ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
    ...(input.sha256 === undefined ? {} : { sha256: input.sha256 }),
  };
}

function toCoreLink(input: z.infer<typeof memoryLinkSchema>): MemoryLink {
  return {
    targetKind: input.target_kind,
    targetId: input.target_id,
    relation: input.relation,
    confidence: input.confidence,
    ...(input.valid_from === undefined ? {} : { validFrom: input.valid_from }),
    ...(input.valid_to === undefined ? {} : { validTo: input.valid_to }),
    ...(input.source === undefined ? {} : { source: toCoreSource(input.source) }),
  };
}

function toCoreSource(source: RestMemorySourceRef): MemorySourceRef {
  return {
    kind: source.kind,
    ...(source.session_id === undefined ? {} : { sessionId: source.session_id }),
    ...(source.agent_id === undefined ? {} : { agentId: source.agent_id }),
    ...(source.turn_id === undefined ? {} : { turnId: source.turn_id }),
    ...(source.message_id === undefined ? {} : { messageId: source.message_id }),
    ...(source.excerpt === undefined ? {} : { excerpt: source.excerpt }),
  };
}

type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};
