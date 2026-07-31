#!/usr/bin/env node
/**
 * Sovereign Reform W13 — free-only / never-empty search KPI harness.
 * Runs deterministic vitest integration (mock attempts, no live network).
 *
 * Usage (from repo root or packages/agent-core):
 *   pnpm -C packages/agent-core run search:never-empty-kpi
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const pkgRoot = path.resolve(import.meta.dirname, '..');
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', 'test/tools/providers/search-never-empty-kpi.test.ts'],
  { cwd: pkgRoot, stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
