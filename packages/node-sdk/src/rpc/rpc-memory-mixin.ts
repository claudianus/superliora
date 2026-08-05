/**
 * Memory RPC delegation for `SDKRpcClientBase` — extracted from rpc.ts.
 */

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
} from '#/session/types';

import { SDKRpcClientInteractiveBase } from './rpc-interactive-base';

export abstract class SDKRpcClientMemoryMixin extends SDKRpcClientInteractiveBase {
  async memoryRecall(input: MemorySearchRequest): Promise<readonly MemorySearchResult[]> {
    const rpc = await this.getRpc();
    return rpc.memoryRecall(input);
  }

  async memoryList(input: MemoryListRequest = {}): Promise<readonly MemoryRecord[]> {
    const rpc = await this.getRpc();
    return rpc.memoryList(input);
  }

  async memoryGet(id: string): Promise<MemoryRecord | undefined> {
    const rpc = await this.getRpc();
    return rpc.memoryGet({ id });
  }

  async memoryRemember(input: MemoryCreateInput): Promise<MemoryRecord> {
    const rpc = await this.getRpc();
    return rpc.memoryRemember(input);
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

  async memoryReflect(input: MemoryReflectInput = {}): Promise<MemoryReflectResult> {
    const rpc = await this.getRpc();
    return rpc.memoryReflect(input);
  }

  async memoryInspect(): Promise<MemoryInspectResult> {
    const rpc = await this.getRpc();
    return rpc.memoryInspect({});
  }
}
