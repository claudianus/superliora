/**
 * Memory RPC method bodies — extracted from core-impl.ts.
 */

import type { LioraRecallStore } from '../memory';

import type {
  EmptyPayload,
  MemoryConsolidateResult,
  MemoryCreatePayload,
  MemoryExportResult,
  MemoryForgetPayload,
  MemoryGetPayload,
  MemoryImportPayload,
  MemoryImportResult,
  MemoryListPayload,
  MemoryRecord,
  MemorySearchPayload,
  MemorySearchResult,
  MemoryStats,
  MemoryUpdatePayload,
} from './core-api';

export interface CoreMemoryMethodsContext {
  readonly memory: LioraRecallStore;
}

export function memorySearch(
  context: CoreMemoryMethodsContext,
  payload: MemorySearchPayload,
): Promise<readonly MemorySearchResult[]> {
  return context.memory.search(payload);
}

export function memoryList(
  context: CoreMemoryMethodsContext,
  payload: MemoryListPayload,
): Promise<readonly MemoryRecord[]> {
  return context.memory.list(payload);
}

export function memoryGet(
  context: CoreMemoryMethodsContext,
  payload: MemoryGetPayload,
): Promise<MemoryRecord | undefined> {
  return context.memory.get(payload.id);
}

export function memoryCreate(
  context: CoreMemoryMethodsContext,
  payload: MemoryCreatePayload,
): Promise<MemoryRecord> {
  return context.memory.remember(payload);
}

export function memoryUpdate(
  context: CoreMemoryMethodsContext,
  payload: MemoryUpdatePayload,
): Promise<MemoryRecord> {
  return context.memory.update(payload.id, payload.patch);
}

export function memoryForget(
  context: CoreMemoryMethodsContext,
  payload: MemoryForgetPayload,
): Promise<boolean> {
  return context.memory.forget(payload.id);
}

export function memoryStats(
  context: CoreMemoryMethodsContext,
  _payload: EmptyPayload,
): Promise<MemoryStats> {
  return context.memory.stats();
}

export function memoryExport(
  context: CoreMemoryMethodsContext,
  payload: MemoryListPayload,
): Promise<MemoryExportResult> {
  return context.memory.exportRecords(payload);
}

export function memoryImport(
  context: CoreMemoryMethodsContext,
  payload: MemoryImportPayload,
): Promise<MemoryImportResult> {
  return context.memory.importRecords(payload.records);
}

export function memoryConsolidate(
  context: CoreMemoryMethodsContext,
  _payload: EmptyPayload,
): Promise<MemoryConsolidateResult> {
  return context.memory.consolidate();
}
