import type {
  MemoryCreateInput,
  MemoryExportResult,
  MemoryImportResult,
  MemoryListRequest,
  MemoryInspectResult,
  MemoryRecord,
  MemoryReflectInput,
  MemoryReflectResult,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryStats,
  MemoryUpdateInput,
} from '#/memory';

export type {
  MemoryCreateInput,
  MemoryExportResult,
  MemoryImportResult,
  MemoryListRequest,
  MemoryInspectResult,
  MemoryRecord,
  MemoryReflectInput,
  MemoryReflectResult,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryStats,
  MemoryUpdateInput,
};

export type MemoryRecallPayload = MemorySearchRequest;
export type MemoryListPayload = MemoryListRequest;
export type MemoryRememberPayload = MemoryCreateInput;
export type MemoryReflectPayload = MemoryReflectInput;

export interface MemoryGetPayload {
  readonly id: string;
}

export interface MemoryUpdatePayload {
  readonly id: string;
  readonly patch: MemoryUpdateInput;
}

export interface MemoryForgetPayload {
  readonly id: string;
}

export interface MemoryImportPayload {
  readonly records: readonly MemoryRecord[];
}
