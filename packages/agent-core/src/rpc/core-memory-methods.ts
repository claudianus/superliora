/**
 * Memory RPC method bodies — extracted from core-impl.ts.
 */

import type { LioraMemoryStore } from '../memory';

import type {
  EmptyPayload,
  MemoryInspectResult,
  MemoryRememberPayload,
  MemoryExportResult,
  MemoryForgetPayload,
  MemoryGetPayload,
  MemoryImportPayload,
  MemoryImportResult,
  MemoryListPayload,
  MemoryRecord,
  MemoryRecallPayload,
  MemorySearchResult,
  MemoryReflectPayload,
  MemoryReflectResult,
  MemoryStats,
  MemoryUpdatePayload,
} from './core-api';

export interface CoreMemoryMethodsContext {
  readonly memory: LioraMemoryStore;
}

export function memoryRecall(
  context: CoreMemoryMethodsContext,
  payload: MemoryRecallPayload,
): Promise<readonly MemorySearchResult[]> {
  return context.memory.recall(payload);
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

export function memoryRemember(
  context: CoreMemoryMethodsContext,
  payload: MemoryRememberPayload,
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

export function memoryReflect(
  context: CoreMemoryMethodsContext,
  payload: MemoryReflectPayload,
): Promise<MemoryReflectResult> {
  return context.memory.reflect(payload);
}

export function memoryInspect(
  context: CoreMemoryMethodsContext,
  _payload: EmptyPayload,
): Promise<MemoryInspectResult> {
  return context.memory.inspect();
}
