import type { RendererFrameDiff } from './cell-buffer';
import type { RendererCursorState, RendererTerminalOutputOptions } from './terminal-output';

export type RendererFrameOutputMode = 'empty' | 'cursor-only' | 'partial' | 'full';
export type RendererFrameOutputPolicyProfile = 'compat' | 'balanced' | 'premium';
export type RendererSynchronizedOutputPolicy = 'inherit' | 'always' | 'auto' | 'never';
export type RendererFrameOutputDecisionReason =
  | 'inherited'
  | 'forced'
  | 'disabled'
  | 'empty'
  | 'cursor-only'
  | 'full-frame'
  | 'changed-cells'
  | 'output-runs'
  | 'output-cells'
  | 'damage-ratio'
  | 'below-threshold';

export interface RendererFrameOutputPolicyOptions {
  readonly profile?: RendererFrameOutputPolicyProfile;
  readonly synchronized?: RendererSynchronizedOutputPolicy;
  readonly syncFullFrame?: boolean;
  readonly syncMinChangedCells?: number;
  readonly syncMinOutputRuns?: number;
  readonly syncMinOutputCells?: number;
  readonly syncMinDamageRatio?: number;
  readonly eraseLine?: boolean;
}

export type RendererFrameOutputPolicyInput =
  | RendererFrameOutputPolicyProfile
  | RendererFrameOutputPolicyOptions;

export interface RendererFrameOutputPolicyContext {
  readonly diff: RendererFrameDiff;
  readonly cursor?: RendererCursorState;
  readonly outputOptions?: RendererTerminalOutputOptions;
  readonly policy?: RendererFrameOutputPolicyInput;
}

export interface RendererFrameOutputDecision {
  readonly mode: RendererFrameOutputMode;
  readonly synchronized: boolean;
  readonly largeFrame: boolean;
  readonly reason: RendererFrameOutputDecisionReason;
  readonly eraseLine: boolean;
  readonly options: RendererTerminalOutputOptions;
}

interface ResolvedRendererFrameOutputPolicy {
  readonly profile: RendererFrameOutputPolicyProfile;
  readonly synchronized: RendererSynchronizedOutputPolicy;
  readonly syncFullFrame: boolean;
  readonly syncMinChangedCells: number;
  readonly syncMinOutputRuns: number;
  readonly syncMinOutputCells: number;
  readonly syncMinDamageRatio: number;
  readonly eraseLine: boolean;
}

const DEFAULT_FRAME_OUTPUT_POLICY: ResolvedRendererFrameOutputPolicy = {
  profile: 'balanced',
  synchronized: 'inherit',
  syncFullFrame: true,
  syncMinChangedCells: 32,
  syncMinOutputRuns: 8,
  syncMinOutputCells: 64,
  syncMinDamageRatio: 0.15,
  eraseLine: false,
};

const FRAME_OUTPUT_PROFILE_POLICIES = {
  compat: {
    profile: 'compat',
    synchronized: 'never',
    syncFullFrame: false,
    syncMinChangedCells: Number.POSITIVE_INFINITY,
    syncMinOutputRuns: Number.POSITIVE_INFINITY,
    syncMinOutputCells: Number.POSITIVE_INFINITY,
    syncMinDamageRatio: 1,
    eraseLine: false,
  },
  balanced: {
    profile: 'balanced',
    synchronized: 'auto',
    syncFullFrame: true,
    syncMinChangedCells: 32,
    syncMinOutputRuns: 8,
    syncMinOutputCells: 64,
    syncMinDamageRatio: 0.15,
    eraseLine: true,
  },
  premium: {
    profile: 'premium',
    synchronized: 'auto',
    syncFullFrame: true,
    syncMinChangedCells: 1,
    syncMinOutputRuns: 1,
    syncMinOutputCells: 1,
    syncMinDamageRatio: 0,
    eraseLine: true,
  },
} satisfies Record<RendererFrameOutputPolicyProfile, ResolvedRendererFrameOutputPolicy>;

export function resolveRendererFrameOutputPolicy(
  context: RendererFrameOutputPolicyContext,
): RendererFrameOutputDecision {
  const policy = resolveFrameOutputPolicy(context.policy);
  const mode = resolveFrameOutputMode(context.diff, context.cursor);
  const largeFrame = isLargeFrame(context.diff, mode, policy);
  const { synchronized, reason } = resolveSynchronizedOutput(context, policy, mode, largeFrame);

  return {
    mode,
    synchronized,
    largeFrame,
    reason,
    eraseLine: context.outputOptions?.eraseLine ?? policy.eraseLine,
    options: {
      ...context.outputOptions,
      synchronized,
      eraseLine: context.outputOptions?.eraseLine ?? policy.eraseLine,
    },
  };
}

export function resolveRendererFrameOutputMode(
  diff: RendererFrameDiff,
  cursor?: RendererCursorState,
): RendererFrameOutputMode {
  return resolveFrameOutputMode(diff, cursor);
}

function resolveFrameOutputPolicy(
  input: RendererFrameOutputPolicyInput | undefined,
): ResolvedRendererFrameOutputPolicy {
  if (typeof input === 'string') {
    return { ...FRAME_OUTPUT_PROFILE_POLICIES[input] };
  }

  const base =
    input?.profile === undefined
      ? DEFAULT_FRAME_OUTPUT_POLICY
      : FRAME_OUTPUT_PROFILE_POLICIES[input.profile];

  return {
    profile: input?.profile ?? base.profile,
    synchronized: input?.synchronized ?? base.synchronized,
    syncFullFrame: input?.syncFullFrame ?? base.syncFullFrame,
    syncMinChangedCells: normalizeChangedCellThreshold(
      input?.syncMinChangedCells,
      base.syncMinChangedCells,
    ),
    syncMinOutputRuns: normalizeOutputThreshold(
      input?.syncMinOutputRuns,
      base.syncMinOutputRuns,
    ),
    syncMinOutputCells: normalizeOutputThreshold(
      input?.syncMinOutputCells,
      base.syncMinOutputCells,
    ),
    syncMinDamageRatio: normalizeDamageRatioThreshold(
      input?.syncMinDamageRatio,
      base.syncMinDamageRatio,
    ),
    eraseLine: input?.eraseLine ?? base.eraseLine,
  };
}

function resolveFrameOutputMode(
  diff: RendererFrameDiff,
  cursor: RendererCursorState | undefined,
): RendererFrameOutputMode {
  if (diff.changedCells <= 0) return cursor === undefined ? 'empty' : 'cursor-only';
  if (
    diff.force ||
    diff.scanStrategy === 'full-frame' ||
    (diff.totalCells > 0 && diff.changedCells >= diff.totalCells)
  ) {
    return 'full';
  }
  return 'partial';
}

function isLargeFrame(
  diff: RendererFrameDiff,
  mode: RendererFrameOutputMode,
  policy: ResolvedRendererFrameOutputPolicy,
): boolean {
  if (mode === 'empty' || mode === 'cursor-only') return false;
  if (mode === 'full' && policy.syncFullFrame) return true;
  if (diff.changedCells >= policy.syncMinChangedCells) return true;
  if (rendererOutputRuns(diff) >= policy.syncMinOutputRuns) return true;
  if (rendererOutputCells(diff) >= policy.syncMinOutputCells) return true;
  return diff.damageRatio >= policy.syncMinDamageRatio;
}

function resolveSynchronizedOutput(
  context: RendererFrameOutputPolicyContext,
  policy: ResolvedRendererFrameOutputPolicy,
  mode: RendererFrameOutputMode,
  largeFrame: boolean,
): { synchronized: boolean; reason: RendererFrameOutputDecisionReason } {
  if (mode === 'empty') return { synchronized: false, reason: 'empty' };
  const supported = context.outputOptions?.synchronized === true;
  if (!supported) return { synchronized: false, reason: 'disabled' };

  switch (policy.synchronized) {
    case 'inherit':
      return { synchronized: true, reason: 'inherited' };
    case 'always':
      return { synchronized: true, reason: 'forced' };
    case 'never':
      return { synchronized: false, reason: 'disabled' };
    case 'auto':
      return largeFrame || mode === 'cursor-only'
        ? { synchronized: true, reason: mode === 'cursor-only' ? 'cursor-only' : largeFrameReason(context.diff, mode, policy) }
        : { synchronized: false, reason: 'below-threshold' };
  }
}

function largeFrameReason(
  diff: RendererFrameDiff,
  mode: RendererFrameOutputMode,
  policy: ResolvedRendererFrameOutputPolicy,
): RendererFrameOutputDecisionReason {
  if (mode === 'full' && policy.syncFullFrame) return 'full-frame';
  if (diff.changedCells >= policy.syncMinChangedCells) return 'changed-cells';
  if (rendererOutputRuns(diff) >= policy.syncMinOutputRuns) return 'output-runs';
  if (rendererOutputCells(diff) >= policy.syncMinOutputCells) return 'output-cells';
  return 'damage-ratio';
}

function normalizeChangedCellThreshold(value: number | undefined, fallback: number): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizeDamageRatioThreshold(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function normalizeOutputThreshold(value: number | undefined, fallback: number): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function rendererOutputRuns(diff: RendererFrameDiff): number {
  return diff.renderRuns ?? (diff.changedCells > 0 ? 1 : 0);
}

function rendererOutputCells(diff: RendererFrameDiff): number {
  return diff.outputCells ?? diff.changedCells;
}
