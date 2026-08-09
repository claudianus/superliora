/**
 * Process-local (+ optional disk) EMA of alias×role route outcomes.
 * Tie-breaks catalog rankScore; does not replace quality/value scores.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import type { ModelMetadata, ModelRole } from '../../utils/model-presets';

type OutcomeKey = `${ModelRole}::${string}`;

type OutcomeRow = {
  success: number;
  fail: number;
  /** EMA in 0..1; higher = more successful. */
  ema: number;
};

const DEFAULT_EMA = 0.55;
const EMA_ALPHA = 0.2;

const store = new Map<OutcomeKey, OutcomeRow>();
let loaded = false;
/** Undefined = process-local only (default). Disk is opt-in. */
let persistPath: string | undefined;

function key(role: ModelRole, alias: string): OutcomeKey {
  return `${role}::${alias}`;
}

function defaultPersistPath(): string | undefined {
  // Opt-in disk so catalog picks stay deterministic unless the operator enables
  // cross-session learning (and so CI/vitest never read a polluted home file).
  const configured = process.env['SUPERLIORA_SMART_ROUTER_OUTCOMES']?.trim();
  if (configured === undefined || configured.length === 0 || configured === '0') {
    return undefined;
  }
  if (configured === '1') {
    return join(homedir(), '.superliora', 'smart-router-outcomes.json');
  }
  return configured;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  persistPath = defaultPersistPath();
  if (persistPath === undefined) return;
  try {
    const raw = readFileSync(persistPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, OutcomeRow>;
    for (const [k, row] of Object.entries(parsed)) {
      if (
        typeof row?.ema === 'number' &&
        typeof row.success === 'number' &&
        typeof row.fail === 'number'
      ) {
        store.set(k as OutcomeKey, row);
      }
    }
  } catch {
    /* first run / unreadable — empty store */
  }
}

function persist(): void {
  if (persistPath === undefined) return;
  try {
    mkdirSync(dirname(persistPath), { recursive: true });
    const obj: Record<string, OutcomeRow> = {};
    for (const [k, row] of store) obj[k] = row;
    writeFileSync(persistPath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  } catch {
    /* best-effort */
  }
}

export function recordRouteOutcome(input: {
  readonly role: ModelRole;
  readonly alias: string;
  readonly ok: boolean;
}): void {
  ensureLoaded();
  const k = key(input.role, input.alias);
  const prev = store.get(k) ?? { success: 0, fail: 0, ema: DEFAULT_EMA };
  const sample = input.ok ? 1 : 0;
  const next: OutcomeRow = {
    success: prev.success + (input.ok ? 1 : 0),
    fail: prev.fail + (input.ok ? 0 : 1),
    ema: prev.ema * (1 - EMA_ALPHA) + sample * EMA_ALPHA,
  };
  store.set(k, next);
  persist();
}

export function routeOutcomeEma(role: ModelRole, alias: string): number {
  ensureLoaded();
  return store.get(key(role, alias))?.ema ?? DEFAULT_EMA;
}

/**
 * Stable re-order: among equal catalog order, prefer higher EMA.
 * Does not change relative order when EMA deltas are tiny.
 */
export function applyOutcomeTieBreak(
  role: ModelRole,
  models: readonly ModelMetadata[],
): ModelMetadata[] {
  ensureLoaded();
  return [...models].toSorted((a, b) => {
    const aliasA = a.alias ?? a.id;
    const aliasB = b.alias ?? b.id;
    const emaA = routeOutcomeEma(role, aliasA);
    const emaB = routeOutcomeEma(role, aliasB);
    if (Math.abs(emaA - emaB) < 0.05) return 0;
    return emaB - emaA;
  });
}

/** Test helper — wipe in-memory + optional disk path override. */
export function resetRouteOutcomeStoreForTests(path?: string): void {
  store.clear();
  loaded = false;
  persistPath = path ?? join(homedir(), '.superliora', 'smart-router-outcomes.test.json');
}
