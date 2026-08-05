import { createDecorator } from '../../di';
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
} from '../../memory';

export interface IMemoryService {
  readonly _serviceBrand: undefined;
  recall(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]>;
  list(request?: MemoryListRequest): Promise<readonly MemoryRecord[]>;
  get(id: string): Promise<MemoryRecord | undefined>;
  remember(input: MemoryCreateInput): Promise<MemoryRecord>;
  update(id: string, patch: MemoryUpdateInput): Promise<MemoryRecord>;
  forget(id: string): Promise<boolean>;
  stats(): Promise<MemoryStats>;
  exportMemories(request?: MemoryListRequest): Promise<MemoryExportResult>;
  importMemories(records: readonly MemoryRecord[]): Promise<MemoryImportResult>;
  reflect(input?: MemoryReflectInput): Promise<MemoryReflectResult>;
  inspect(): Promise<MemoryInspectResult>;
}

export const IMemoryService = createDecorator<IMemoryService>('memoryService');

void IMemoryService;
