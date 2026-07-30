import type {
  MemoryConsolidateResult,
  MemoryCreateInput,
  MemoryExportResult,
  MemoryImportResult,
  MemoryListRequest,
  MemoryRecord,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryStats,
  MemoryUpdateInput,
} from '#/memory';

export type {
  MemoryConsolidateResult,
  MemoryCreateInput,
  MemoryExportResult,
  MemoryImportResult,
  MemoryListRequest,
  MemoryRecord,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryStats,
  MemoryUpdateInput,
};

export type MemorySearchPayload = MemorySearchRequest;
export type MemoryListPayload = MemoryListRequest;
export type MemoryCreatePayload = MemoryCreateInput;

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
