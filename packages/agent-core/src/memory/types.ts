import type { ContentPart } from '@superliora/kosong';

export type MemoryType = 'fact' | 'event' | 'procedure' | 'task' | 'rule';
export type MemoryEpistemic = 'direct' | 'inferred' | 'preference' | 'summary';
export type MemoryScope = 'user' | 'workspace' | 'session';
export type MemoryStatus = 'candidate' | 'active' | 'archived' | 'superseded' | 'deleted';

export interface MemorySourceRef {
  readonly kind: 'user' | 'tool' | 'auto' | 'import' | 'system';
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly turnId?: number;
  readonly messageId?: string;
  readonly excerpt?: string;
}

export interface MemoryEvidenceRef {
  readonly kind: 'file' | 'symbol' | 'run' | 'message' | 'memory' | 'url';
  readonly id: string;
  readonly excerpt?: string;
  readonly sha256?: string;
}

export interface MemoryLink {
  readonly targetKind: 'memory' | 'file' | 'symbol' | 'run' | 'evidence';
  readonly targetId: string;
  readonly relation: string;
  readonly confidence: number;
  readonly validFrom?: number;
  readonly validTo?: number;
  readonly source?: MemorySourceRef;
}

export interface MemoryRecord {
  readonly id: string;
  readonly type: MemoryType;
  readonly epistemic: MemoryEpistemic;
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
  readonly recordedAt: number;
  readonly accessedAt?: number;
  readonly accessCount: number;
  readonly validFrom?: number;
  readonly validTo?: number;
  readonly invalidAt?: number;
  readonly supersedes: readonly string[];
  readonly supersededBy?: string;
  readonly evidenceRefs: readonly MemoryEvidenceRef[];
  readonly links: readonly MemoryLink[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MemoryCreateInput {
  readonly type: MemoryType;
  readonly epistemic?: MemoryEpistemic;
  readonly scope?: MemoryScope;
  readonly scopeKey?: string;
  readonly subject: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly confidence?: number;
  readonly importance?: number;
  readonly status?: MemoryStatus;
  readonly source?: MemorySourceRef;
  readonly validFrom?: number;
  readonly validTo?: number;
  readonly evidenceRefs?: readonly MemoryEvidenceRef[];
  readonly links?: readonly MemoryLink[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemoryUpdateInput {
  readonly type?: MemoryType;
  readonly epistemic?: MemoryEpistemic;
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
  readonly invalidAt?: number;
  readonly supersededBy?: string;
  readonly evidenceRefs?: readonly MemoryEvidenceRef[];
  readonly links?: readonly MemoryLink[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemorySearchRequest {
  readonly query?: string;
  readonly type?: MemoryType;
  readonly types?: readonly MemoryType[];
  readonly scope?: MemoryScope;
  readonly scopeKey?: string;
  readonly workspaceKey?: string;
  readonly sessionId?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
  readonly tokenBudget?: number;
  readonly asOf?: number;
  /** When set, results with `score < minScore` are excluded. */
  readonly minScore?: number;
  readonly includeArchived?: boolean;
  readonly includeDeleted?: boolean;
  readonly includeCandidates?: boolean;
  readonly expandLinks?: boolean;
}

export interface MemoryListRequest {
  readonly type?: MemoryType;
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
  readonly linkPath?: readonly string[];
  readonly abstained?: boolean;
  readonly abstentionReason?: string;
}

export interface MemoryStats {
  readonly total: number;
  readonly active: number;
  readonly archived: number;
  readonly deleted: number;
  readonly byType: Readonly<Record<MemoryType, number>>;
  readonly byScope: Readonly<Record<MemoryScope, number>>;
  readonly candidates: number;
}

export interface MemoryExportResult {
  readonly exportedAt: number;
  readonly schemaVersion: 2;
  readonly records: readonly MemoryRecord[];
}

export interface MemoryImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly updated: number;
}

export interface MemoryReflectInput {
  readonly limit?: number;
  readonly dryRun?: boolean;
  readonly force?: boolean;
}

export interface MemoryReflectResult {
  readonly examined: number;
  readonly merged: number;
  readonly promoted: number;
  readonly rejected: number;
}

export interface MemoryAuditEvent {
  readonly id: string;
  readonly memoryId: string;
  readonly action: string;
  readonly source: MemorySourceRef;
  readonly createdAt: number;
}

export interface MemoryInspectResult {
  readonly storePath: string;
  readonly schemaVersion: number;
  readonly integrity: {
    readonly ok: boolean;
    readonly issues: readonly string[];
  };
  readonly stats: MemoryStats;
  readonly recentEvents: readonly MemoryAuditEvent[];
}

export interface LioraMemoryConfig {
  readonly enabled?: boolean;
  readonly storePath?: string;
  readonly maxRetrieved?: number;
  /** Minimum score floor for query-based injection; defaults to 0.35 when unset. */
  readonly minInjectionScore?: number;
  readonly captureMode?: 'off' | 'explicit' | 'candidate';
  readonly reflectEnabled?: boolean;
  readonly retentionDays?: number;
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
  recall(request: MemorySearchRequest): Promise<readonly MemorySearchResult[]>;
  list(request?: MemoryListRequest): Promise<readonly MemoryRecord[]>;
  get(id: string): Promise<MemoryRecord | undefined>;
  remember(input: MemoryCreateInput): Promise<MemoryRecord>;
  update(id: string, patch: MemoryUpdateInput): Promise<MemoryRecord>;
  forget(id: string): Promise<boolean>;
  reflect(input?: MemoryReflectInput): Promise<MemoryReflectResult>;
  inspect(): Promise<MemoryInspectResult>;
  getInjection(query?: string): Promise<string | undefined>;
  recordTurn(input: MemoryTurnCaptureInput): Promise<readonly MemoryRecord[]>;
}

export interface SessionMemoryRuntime {
  forAgent(context: MemoryRuntimeAgentContext): AgentMemoryRuntime;
}
