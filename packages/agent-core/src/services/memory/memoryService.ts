import { Disposable, InstantiationType, registerSingleton } from '../../di';
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
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IMemoryService } from './memory';

export class MemoryService extends Disposable implements IMemoryService {
  readonly _serviceBrand: undefined;

  constructor(@ICoreProcessService private readonly core: ICoreProcessService) {
    super();
  }

  recall(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    return this.core.rpc.memoryRecall(request);
  }

  list(request: MemoryListRequest = {}): Promise<readonly MemoryRecord[]> {
    return this.core.rpc.memoryList(request);
  }

  get(id: string): Promise<MemoryRecord | undefined> {
    return this.core.rpc.memoryGet({ id });
  }

  remember(input: MemoryCreateInput): Promise<MemoryRecord> {
    return this.core.rpc.memoryRemember(input);
  }

  update(id: string, patch: MemoryUpdateInput): Promise<MemoryRecord> {
    return this.core.rpc.memoryUpdate({ id, patch });
  }

  forget(id: string): Promise<boolean> {
    return this.core.rpc.memoryForget({ id });
  }

  stats(): Promise<MemoryStats> {
    return this.core.rpc.memoryStats({});
  }

  exportMemories(request: MemoryListRequest = {}): Promise<MemoryExportResult> {
    return this.core.rpc.memoryExport(request);
  }

  importMemories(records: readonly MemoryRecord[]): Promise<MemoryImportResult> {
    return this.core.rpc.memoryImport({ records });
  }

  reflect(input: MemoryReflectInput = {}): Promise<MemoryReflectResult> {
    return this.core.rpc.memoryReflect(input);
  }

  inspect(): Promise<MemoryInspectResult> {
    return this.core.rpc.memoryInspect({});
  }
}

registerSingleton(IMemoryService, MemoryService, InstantiationType.Delayed);
