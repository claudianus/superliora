import type {
  ModelAlias,
  PermissionMode,
  ProviderConfig,
  ProviderRouteSelection,
  ProviderRouteStatus,
  SessionStatus,
} from '@superliora/sdk';

import type { GitStatus } from '#/utils/git/git-status';

import type { ManagedUsageReport } from '../usage-panel/index';
import type { StatusFieldMotionState } from './field-motion';


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
  readonly upstreamBaseline?: string;
  /** Product telemetry enabled (false ≈ ZDR-friendlier local posture). */
  readonly privacyTelemetryEnabled?: boolean;
  /** Active runtime tools. */
  /** Optional field-value crossfade tracker across rebuilds. */
  readonly fieldMotion?: StatusFieldMotionState;
}
