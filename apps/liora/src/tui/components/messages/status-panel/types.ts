import type {
  ModelAlias,
  PermissionMode,
  ProviderConfig,
  ProviderRouteSelection,
  ProviderRouteStatus,
  SessionStatus,
} from '@superliora/sdk';

import type { GitStatus } from '#/utils/git/git-status';
import type { LoopModelRoutingConfig } from '#/tui/utils/model/loop-model-routing';

import type { ManagedUsageReport } from '../usage-panel/index';
import type { StatusFieldMotionState } from './field-motion';

export type StatusGoalStatus = 'active' | 'paused' | 'blocked' | 'complete';

export interface StatusHumanWritingReadiness {
  readonly ready: boolean;
  readonly advisoryOnly: boolean;
  readonly nextAction: string;
}

export interface StatusRecoveryReadiness {
  readonly ready: boolean;
  readonly nextAction: string;
  readonly evidencePath?: string;
}

export interface StatusReportOptions {
  readonly version: string;
  readonly model: string;
  readonly workDir: string;
  readonly sessionId: string;
  /** Global process log path (`~/.superliora/logs/liora.log`). */
  readonly globalLogPath?: string;
  /** Session-scoped log path when a session dir is known. */
  readonly sessionLogPath?: string;
  readonly sessionTitle: string | null;
  readonly thinking: boolean;
  readonly permissionMode: PermissionMode;
  readonly planMode: boolean;
  readonly premiumQualityMode?: boolean;
  readonly goalStatus?: StatusGoalStatus;
  readonly contextUsage: number;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly availableModels: Record<string, ModelAlias>;
  readonly availableProviders?: Record<string, ProviderConfig>;
  readonly providerRouteStatus?: ProviderRouteStatus | null;
  readonly lastProviderRouteSelection?: ProviderRouteSelection | null;
  readonly lastModelRouteNotice?: {
    readonly kind: 'failover' | 'switch' | 'selection';
    readonly fromAlias?: string;
    readonly toAlias: string;
    readonly providerName?: string;
    readonly credentialLabel?: string;
    readonly providerModel?: string;
    readonly reason?: string;
    readonly atMs: number;
  } | null;
  readonly status?: SessionStatus;
  readonly statusError?: string;
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
  readonly gitStatus?: GitStatus | null;
  readonly humanWriting?: StatusHumanWritingReadiness;
  readonly recovery?: StatusRecoveryReadiness;
  readonly upstreamBaseline?: string;
  readonly contextOS?: {
    readonly pageCount: number;
    readonly readyPageCount: number;
    readonly needsRehydrationPageCount: number;
    readonly atRiskPageCount: number;
    readonly missingEvidencePageCount: number;
    readonly evidenceIdRecallScore: number;
    readonly latestContinuityStatus: string;
  };
  readonly autoDream?: {
    readonly enabled: boolean;
    readonly inFlight: boolean;
    readonly runs: number;
    readonly lastDreamAt: number | null;
    readonly lastExamined: number | null;
    readonly lastMerged: number | null;
    readonly minHours: number;
    readonly minActiveRecords: number;
  } | null;
  /** Product telemetry enabled (false ≈ ZDR-friendlier local posture). */
  readonly privacyTelemetryEnabled?: boolean;
  /** Active tool names from the session (for research/media readiness). */
  readonly activeToolNames?: readonly string[];
  /** Explicit loop-role model overrides loaded from persisted harness config. */
  readonly loopModelRouting?: LoopModelRoutingConfig;
  /** Error while loading explicit loop-role model overrides. */
  readonly loopModelRoutingError?: string;
  /** Optional field-value crossfade tracker across rebuilds. */
  readonly fieldMotion?: StatusFieldMotionState;
}
