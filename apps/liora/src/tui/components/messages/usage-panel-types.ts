import type {
  AllProvidersUsageSnapshot,
  ContextComposition,
  SessionUsage,
} from '@superliora/sdk';

import type { ColorToken } from '#/tui/theme';

export interface ManagedUsageRow {
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly resetHint?: string;
}

export interface ManagedAccountUsageReport {
  readonly accountKey: string;
  readonly label?: string;
  readonly isPrimary?: boolean;
  readonly summary: ManagedUsageRow | null;
  readonly limits: readonly ManagedUsageRow[];
  readonly error?: string;
  readonly status?: 'ok' | 'error' | 'loading';
}

export interface ManagedUsageReport {
  readonly summary: ManagedUsageRow | null;
  readonly limits: readonly ManagedUsageRow[];
  readonly accounts?: readonly ManagedAccountUsageReport[];
}

export interface UsageReportOptions {
  readonly sessionUsage?: SessionUsage;
  readonly sessionUsageError?: string;
  readonly contextUsage: number;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  /**
   * Soft working-set policy (Settings → Context). When set, a second gauge
   * shows live history pressure against the agent cap, not only the model window.
   */
  readonly workingSet?: {
    readonly maxWorkingSetTokens: number;
    readonly asyncWorkingSetTokens: number;
    readonly presetId?: string;
  } | null;
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
  /** 0..1 multiplier applied to plan usage bars during ambient fill animation. */
  readonly managedUsageFillProgress?: number;
  /** Multi-provider quota snapshot for the Provider Quotas section. */
  readonly providerQuota?: AllProvidersUsageSnapshot | null;
  /** When true, only render the provider quota section (skip session/cache/context). */
  readonly providerQuotaOnly?: boolean;
}

export interface ManagedUsageReportLineOptions {
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
  readonly managedUsageFillProgress?: number;
}

export type UsagePanelPhase = 'loading' | 'ready';

export interface UsagePanelComponentOptions {
  readonly buildLines: (fillProgress: number) => readonly string[];
  readonly borderToken?: ColorToken;
  readonly title?: string;
  /** Request a layout/content re-render for clock-driven animation frames. */
  readonly requestRender?: (() => void) | undefined;
  readonly phase?: UsagePanelPhase;
  readonly fillStartedAtMs?: number | undefined;
  /** Seed for the open enter beat (defaults to trimmed title). */
  readonly enterBeatSeed?: string;
  readonly openedAtMs?: number;
}

export type { ContextComposition };
