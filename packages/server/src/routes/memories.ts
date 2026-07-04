import { IMemoryService, type IInstantiationService, type MemoryCreateInput, type MemoryListRequest, type MemoryRecord as CoreMemoryRecord, type MemorySearchRequest, type MemorySourceRef, type MemoryUpdateInput } from '@superliora/agent-core';
import {
  consolidateMemoriesResponseSchema,
  createMemoryRequestSchema,
  createMemoryResponseSchema,
  exportMemoriesResponseSchema,
  forgetMemoryResponseSchema,
  getMemoryResponseSchema,
  importMemoriesRequestSchema,
  importMemoriesResponseSchema,
  listMemoriesQuerySchema,
  listMemoriesResponseSchema,
  memoryStatsResponseSchema,
  searchMemoriesRequestSchema,
  searchMemoriesResponseSchema,
  updateMemoryRequestSchema,
  updateMemoryResponseSchema,
  type MemoryRecord,
  type MemorySourceRef as RestMemorySourceRef,
} from '@superliora/protocol';
import { z } from 'zod';

import { okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';

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
      description: 'List Liora Recall memories',
      tags: ['memories'],
      operationId: 'listMemories',
    },
    async (req, reply) => {
      const memories = await ix.invokeFunction((a) => a.get(IMemoryService).list(toListRequest(req.query)));
      reply.send(okEnvelope({ memories: memories.map(toRestMemory) }, req.id));
    },
  );
  app.get(listRoute.path, listRoute.options, listRoute.handler as Parameters<MemoriesRouteHost['get']>[2]);

  const searchRoute = defineRoute(
    {
      method: 'POST',
      path: '/memories::search',
      body: searchMemoriesRequestSchema,
      success: { data: searchMemoriesResponseSchema },
      description: 'Search Liora Recall memories',
      tags: ['memories'],
      operationId: 'searchMemories',
    },
    async (req, reply) => {
      const results = await ix.invokeFunction((a) => a.get(IMemoryService).search(toSearchRequest(req.body)));
      reply.send(okEnvelope({ memories: results.map((result) => ({ ...result, memory: toRestMemory(result.memory) })) }, req.id));
    },
  );
  app.post(searchRoute.path, searchRoute.options, searchRoute.handler as Parameters<MemoriesRouteHost['post']>[2]);

  const createRoute = defineRoute(
    {
      method: 'POST',
      path: '/memories',
      body: createMemoryRequestSchema,
      success: { data: createMemoryResponseSchema },
      description: 'Create a Liora Recall memory',
      tags: ['memories'],
      operationId: 'createMemory',
    },
    async (req, reply) => {
      const memory = await ix.invokeFunction((a) => a.get(IMemoryService).create(toCreateInput(req.body)));
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
      description: 'Get a Liora Recall memory',
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
      description: 'Update a Liora Recall memory',
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
      description: 'Forget a Liora Recall memory',
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
      description: 'Get Liora Recall memory stats',
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
      description: 'Export Liora Recall memories',
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
      description: 'Import Liora Recall memories',
      tags: ['memories'],
      operationId: 'importMemories',
    },
    async (req, reply) => {
      const result = await ix.invokeFunction((a) => a.get(IMemoryService).importMemories(req.body.records as CoreMemoryRecord[]));
      reply.send(okEnvelope(result, req.id));
    },
  );
  app.post(importRoute.path, importRoute.options, importRoute.handler as Parameters<MemoriesRouteHost['post']>[2]);

  const consolidateRoute = defineRoute(
    {
      method: 'POST',
      path: '/memories::consolidate',
      success: { data: consolidateMemoriesResponseSchema },
      description: 'Consolidate duplicate Liora Recall memories',
      tags: ['memories'],
      operationId: 'consolidateMemories',
    },
    async (req, reply) => {
      const result = await ix.invokeFunction((a) => a.get(IMemoryService).consolidate());
      reply.send(okEnvelope(result, req.id));
    },
  );
  app.post(consolidateRoute.path, consolidateRoute.options, consolidateRoute.handler as Parameters<MemoriesRouteHost['post']>[2]);
}

function toSearchRequest(input: z.infer<typeof searchMemoriesRequestSchema>): MemorySearchRequest {
  const request: Mutable<MemorySearchRequest> = {};
  if (input.query !== undefined) request.query = input.query;
  if (input.kind !== undefined) request.kind = input.kind;
  if (input.kinds !== undefined) request.kinds = input.kinds;
  if (input.scope !== undefined) request.scope = input.scope;
  if (input.scope_key !== undefined) request.scopeKey = input.scope_key;
  if (input.workspace_key !== undefined) request.workspaceKey = input.workspace_key;
  if (input.session_id !== undefined) request.sessionId = input.session_id;
  if (input.tags !== undefined) request.tags = input.tags;
  if (input.limit !== undefined) request.limit = input.limit;
  if (input.include_archived !== undefined) request.includeArchived = input.include_archived;
  if (input.include_deleted !== undefined) request.includeDeleted = input.include_deleted;
  return request;
}

function toListRequest(input: z.infer<typeof listMemoriesQuerySchema>): MemoryListRequest {
  const request: Mutable<MemoryListRequest> = {};
  if (input.kind !== undefined) request.kind = input.kind;
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
    kind: input.kind,
    subject: input.subject,
    content: input.content,
  };
  if (input.scope !== undefined) request.scope = input.scope;
  if (input.scope_key !== undefined) request.scopeKey = input.scope_key;
  if (input.tags !== undefined) request.tags = input.tags;
  if (input.confidence !== undefined) request.confidence = input.confidence;
  if (input.importance !== undefined) request.importance = input.importance;
  if (input.valid_from !== undefined) request.validFrom = input.valid_from;
  if (input.valid_to !== undefined) request.validTo = input.valid_to;
  if (input.metadata !== undefined) request.metadata = input.metadata;
  return request;
}

function toUpdateInput(input: z.infer<typeof updateMemoryRequestSchema>): MemoryUpdateInput {
  const request: Mutable<MemoryUpdateInput> = {};
  if (input.kind !== undefined) request.kind = input.kind;
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
  if (input.superseded_by !== undefined) request.supersededBy = input.superseded_by;
  if (input.metadata !== undefined) request.metadata = input.metadata;
  return request;
}

function toRestMemory(memory: CoreMemoryRecord): MemoryRecord {
  const response: Mutable<MemoryRecord> = {
    id: memory.id,
    kind: memory.kind,
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
    access_count: memory.accessCount,
    supersedes: [...memory.supersedes],
    metadata: memory.metadata,
  };
  if (memory.scopeKey !== undefined) response.scope_key = memory.scopeKey;
  if (memory.accessedAt !== undefined) response.accessed_at = memory.accessedAt;
  if (memory.validFrom !== undefined) response.valid_from = memory.validFrom;
  if (memory.validTo !== undefined) response.valid_to = memory.validTo;
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

type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};
