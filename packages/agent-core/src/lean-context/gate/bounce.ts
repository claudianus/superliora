import type { ToolStore } from '../../tools/store';

export const LIORA_GATE_STORE_KEY = 'liora_gate_state' as const;

export interface ReadAccessRecord {
  readonly path: string;
  readonly mode: 'compressed' | 'full';
  readonly at: number;
}

export interface LioraGateState {
  readonly reads: readonly ReadAccessRecord[];
}

declare module '../../tools/store' {
  interface ToolStoreData {
    liora_gate_state: LioraGateState;
  }
}

function emptyState(): LioraGateState {
  return { reads: [] };
}

export function getGateState(store: ToolStore): LioraGateState {
  return store.get(LIORA_GATE_STORE_KEY) ?? emptyState();
}

export function recordReadAccess(
  store: ToolStore,
  path: string,
  mode: 'compressed' | 'full',
): LioraGateState {
  const previous = getGateState(store);
  const reads = [...previous.reads, { path, mode, at: Date.now() }].slice(-200);
  const next = { reads };
  store.set(LIORA_GATE_STORE_KEY, next);
  return next;
}

export function bounceRateForPath(store: ToolStore, path: string): number {
  const reads = getGateState(store).reads.filter((record) => record.path === path);
  if (reads.length < 2) return 0;
  let bounces = 0;
  for (let i = 1; i < reads.length; i += 1) {
    const prev = reads[i - 1];
    const current = reads[i];
    if (prev?.mode === 'compressed' && current?.mode === 'full') bounces += 1;
  }
  return bounces / (reads.length - 1);
}

export function shouldSkipCompressionForRead(args: unknown): boolean {
  if (typeof args !== 'object' || args === null) return false;
  const record = args as {
    line_offset?: unknown;
    n_lines?: unknown;
    start_line?: unknown;
    limit?: unknown;
    mode?: unknown;
    raw?: unknown;
  };
  // Windowed reads are already scoped — do not re-compress.
  if (
    record.line_offset !== undefined ||
    record.n_lines !== undefined ||
    record.start_line !== undefined ||
    record.limit !== undefined
  ) {
    return true;
  }
  // LioraRead signatures/map/lines are already lean; only full/raw/auto dumps may compress.
  if (record.raw === true) return false;
  if (typeof record.mode === 'string') {
    const mode = record.mode.toLowerCase();
    if (mode === 'signatures' || mode === 'map' || mode === 'lines') return true;
  }
  return false;
}

export function resolvePressureMode(contextUsage: number | undefined): 'normal' | 'signatures' | 'aggressive' {
  if (contextUsage === undefined) return 'normal';
  if (contextUsage >= 0.9) return 'aggressive';
  if (contextUsage >= 0.75) return 'signatures';
  return 'normal';
}
