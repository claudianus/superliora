import type { ContentPart } from '@superliora/kosong';

export type MemoryKind = 'semantic' | 'episodic' | 'procedural' | 'prospective' | 'governance';
export type MemoryScope = 'user' | 'workspace' | 'session';
export type MemoryStatus = 'active' | 'archived' | 'superseded' | 'deleted';

export interface MemorySourceRef {
  readonly kind: 'user' | 'tool' | 'auto' | 'import' | 'system';
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly turnId?: number;
  readonly messageId?: string;
  readonly excerpt?: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly scopeKey?: string;
  readonly subject: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly confidence: number;
  readonly importance: number;
  readonly status: MemoryStatus;
  readonly source: MemorySourceRef;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly accessedAt?: number;
  readonly accessCount: number;
  readonly validFrom?: number;
  readonly validTo?: number;
  readonly supersedes: readonly string[];
  readonly supersededBy?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MemoryCreateInput {
  readonly kind: MemoryKind;
  readonly scope?: MemoryScope;
  readonly scopeKey?: string;
  readonly subject: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly confidence?: number;
  readonly importance?: number;
  readonly source?: MemorySourceRef;
  readonly validFrom?: number;
  readonly validTo?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemoryUpdateInput {
  readonly kind?: MemoryKind;
  readonly scope?: MemoryScope;
  readonly scopeKey?: string;
  readonly subject?: string;
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly confidence?: number;
  readonly importance?: number;
  readonly status?: MemoryStatus;
  readonly validFrom?: number;
  readonly validTo?: number;
  readonly supersededBy?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemorySearchRequest {
  readonly query?: string;
  readonly kind?: MemoryKind;
  readonly kinds?: readonly MemoryKind[];
  readonly scope?: MemoryScope;
  readonly scopeKey?: string;
  readonly workspaceKey?: string;
  readonly sessionId?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
  readonly includeArchived?: boolean;
  readonly includeDeleted?: boolean;
}

export interface MemoryListRequest {
  readonly kind?: MemoryKind;
  readonly scope?: MemoryScope;
  readonly scopeKey?: string;
  readonly workspaceKey?: string;
  readonly sessionId?: string;
  readonly status?: MemoryStatus;
  readonly tags?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface MemorySearchResult {
  readonly memory: MemoryRecord;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface MemoryStats {
  readonly total: number;
  readonly active: number;
  readonly archived: number;
  readonly deleted: number;
  readonly byKind: Readonly<Record<MemoryKind, number>>;
  readonly byScope: Readonly<Record<MemoryScope, number>>;
}

export interface MemoryExportResult {
  readonly exportedAt: number;
  readonly schemaVersion: 1;
  readonly records: readonly MemoryRecord[];
}

export interface MemoryImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly updated: number;
}

export interface MemoryConsolidateResult {
  readonly examined: number;
  readonly merged: number;
}

export interface LioraRecallConfig {
  readonly enabled?: boolean;
  readonly storePath?: string;
  readonly maxRetrieved?: number;
  readonly autoCapture?: boolean;
  readonly captureEpisodic?: boolean;
  readonly autoConsolidate?: boolean;
}

export interface MemoryRuntimeAgentContext {
  readonly sessionId: string;
  readonly agentId: string;
  readonly agentType: 'main' | 'sub' | 'independent';
  readonly workDir: string;
}

export interface MemoryRuntimeSessionContext {
  readonly sessionId: string;
  readonly workDir: string;
}

export interface MemoryTurnCaptureInput {
  readonly turnId: number;
  readonly input: readonly ContentPart[];
  readonly reason: string;
}

export interface AgentMemoryRuntime {
  isEnabled(): boolean;
  search(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]>;
  list(request?: MemoryListRequest): Promise<readonly MemoryRecord[]>;
  get(id: string): Promise<MemoryRecord | undefined>;
  remember(input: MemoryCreateInput): Promise<MemoryRecord>;
  update(id: string, patch: MemoryUpdateInput): Promise<MemoryRecord>;
  forget(id: string): Promise<boolean>;
  getInjection(query?: string): Promise<string | undefined>;
  recordTurn(input: MemoryTurnCaptureInput): Promise<readonly MemoryRecord[]>;
}

export interface SessionMemoryRuntime {
  forAgent(context: MemoryRuntimeAgentContext): AgentMemoryRuntime;
}
