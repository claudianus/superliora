#!/usr/bin/env node
/**
 * Sovereign Reform W1 — 50-turn warm replay cache KPI harness.
 * Runs deterministic vitest integration (mock usage, no live LLM).
 *
 * Usage (from repo root or packages/agent-core):
 *   pnpm -C packages/agent-core run cache:warm-kpi
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const pkgRoot = path.resolve(import.meta.dirname, '..');
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', 'test/agent/cache/warm-replay-kpi.test.ts'],
  { cwd: pkgRoot, stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
