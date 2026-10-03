export interface IndependentSessionRequest {
  prompt: string;
  description: string;
  cwd: string;
  model?: string;
  ownership?: readonly string[];
  timeoutMs?: number;
  purpose?: string;
  sourceRevision?: string;
  workerAncestry?: import('@superliora/protocol').WorkerAncestry;
}

export type CoordinationStatus = 'accepted' | 'admitting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'cancel_requested' | 'idle' | 'yielded' | 'finished';

export interface CoordinationRecord {
  id: string;
  idempotencyKey: string;
  kind?: 'session' | 'pipeline';
  workerAncestry?: import('@superliora/protocol').WorkerAncestry;
  pipeline?: { planId: string; status: 'accepted' | 'running' | 'success' | 'failed' | 'blocked' | 'cancelled' | 'interrupted'; result?: import('../execution/pipeline').PipelineResult };
  request: IndependentSessionRequest;
  revision: number;
  status: CoordinationStatus;
  sessionId?: string;
  lease?: { owner: string; token: string; expiresAt: number };
  mailbox: { id: string; text: string; status: 'pending' | 'sending' | 'delivered' }[];
  verification?: { planId: string; revision: number; status: 'accepted' | 'running' | 'passed' | 'failed' | 'stale' | 'source_changed' | 'interrupted' | 'cancelled'; cancelRequested?: boolean; receipt?: import('../execution/verification').VerificationReceipt; error?: string };
  resumePrompt?: string;
  result?: string;
  error?: string;
}

export interface CoordinatorProjection {
  version: 1;
  records: CoordinationRecord[];
}

/** A store must provide exclusive ownership until close, and atomic durable saves. */
export interface CoordinatorStore {
  load(): Promise<CoordinatorProjection | undefined>;
  save(projection: CoordinatorProjection): Promise<void>;
  close(): Promise<void>;
}

export interface IndependentSessionHandle {
  sessionId: string;
  completion: Promise<string | undefined>;
  message(text: string): Promise<void>;
}

/** Admission and completion must settle only after cancelled execution resources settle. */
export interface IndependentSessionRuntime {
  resume?(sessionId: string, request: IndependentSessionRequest, signal: AbortSignal): Promise<IndependentSessionHandle>;
  admit(id: string, request: IndependentSessionRequest, signal: AbortSignal): Promise<IndependentSessionHandle>;
}

export interface ConductorPolicy {
  role: 'conductor';
  maxConcurrent: number;
  authorizedRoots: readonly string[];
  leaseMs?: number;
}

export class IndependentSessionUnsettledError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IndependentSessionUnsettledError';
  }
}

export interface CoordinationFact {
  id: string;
  sessionId?: string;
  revision: number;
  status: CoordinationStatus;
  kind: 'session' | 'pipeline';
  reusable: boolean;
  ownerStatus?: 'active' | 'idle' | 'yielded' | 'finished' | 'settling' | 'interrupted';
  purpose: string;
  cwd: string;
  sourceRevision?: string;
  workerAncestry?: import('@superliora/protocol').WorkerAncestry;
  pipeline?: { planId: string; status: NonNullable<CoordinationRecord['pipeline']>['status'] };
  verification?: { planId: string; revision: number; status: NonNullable<CoordinationRecord['verification']>['status']; evidencePath?: string; artifactHash?: string };
  lease?: CoordinationRecord['lease'];
  mailbox: { pending: number; uncertain: number };
  result?: string;
  error?: string;
}
