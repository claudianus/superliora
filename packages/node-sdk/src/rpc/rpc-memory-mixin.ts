/**
 * Memory RPC delegation for `SDKRpcClientBase` — extracted from rpc.ts.
 */

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
} from '#/session/types';

import { SDKRpcClientInteractiveBase } from './rpc-interactive-base';

export abstract class SDKRpcClientMemoryMixin extends SDKRpcClientInteractiveBase {
  async memorySearch(input: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    const rpc = await this.getRpc();
    return rpc.memorySearch(input);
  }

  async memoryList(input: MemoryListRequest = {}): Promise<readonly MemoryRecord[]> {
    const rpc = await this.getRpc();
    return rpc.memoryList(input);
  }

  async memoryGet(id: string): Promise<MemoryRecord | undefined> {
    const rpc = await this.getRpc();
    return rpc.memoryGet({ id });
  }

  async memoryCreate(input: MemoryCreateInput): Promise<MemoryRecord> {
    const rpc = await this.getRpc();
    return rpc.memoryCreate(input);
  }

  async memoryUpdate(id: string, patch: MemoryUpdateInput): Promise<MemoryRecord> {
    const rpc = await this.getRpc();
    return rpc.memoryUpdate({ id, patch });
  }

  async memoryForget(id: string): Promise<boolean> {
    const rpc = await this.getRpc();
    return rpc.memoryForget({ id });
  }

  async memoryStats(): Promise<MemoryStats> {
    const rpc = await this.getRpc();
    return rpc.memoryStats({});
  }

  async memoryExport(input: MemoryListRequest = {}): Promise<MemoryExportResult> {
    const rpc = await this.getRpc();
    return rpc.memoryExport(input);
  }

  async memoryImport(records: readonly MemoryRecord[]): Promise<MemoryImportResult> {
    const rpc = await this.getRpc();
    return rpc.memoryImport({ records });
  }

  async memoryConsolidate(): Promise<MemoryConsolidateResult> {
    const rpc = await this.getRpc();
    return rpc.memoryConsolidate({});
  }
}
